import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { billingConfigFromEnv, isBillingConfigured } from "@/lib/billing/config";
import { entitlementsFor, hasFeature } from "@/lib/billing/entitlements";
import {
  handleStripeWebhook,
  planForStatus,
  syncFromSubscription,
  type BillingStore,
  type SubscriptionSync,
} from "@/lib/billing/webhook";
import { createLogger } from "@/lib/logger";

// Stripe simulé : seule la vérification de signature du SDK (locale, sans réseau) est réelle.
const SECRET = "whsec_test_fixture";
const sdk = new Stripe("sk_test_never_used");

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/stripe/${name}.json`, import.meta.url), "utf8");

function signed(name: string, secret = SECRET) {
  const payload = fixture(name);
  return { payload, signature: sdk.webhooks.generateTestHeaderString({ payload, secret }) };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return { ...JSON.parse(fixture("subscription")), ...overrides } as Stripe.Subscription;
}

/** Stockage en mémoire, mêmes règles que le stockage Prisma (journal des évènements). */
function memoryStore() {
  const events = new Set<string>();
  const applied: SubscriptionSync[] = [];
  const store: BillingStore = {
    isProcessed: async (id) => events.has(id),
    apply: vi.fn(async (event, sync) => {
      if (events.has(event.id)) return "duplicate";
      events.add(event.id);
      if (sync) applied.push(sync);
      return "applied";
    }),
  };
  return { store, applied };
}

function setup(current: Stripe.Subscription = subscription()) {
  const retrieve = vi.fn(async () => current);
  const { store, applied } = memoryStore();
  const lines: string[] = [];
  const run = (input: { payload: string; signature: string | null }) =>
    handleStripeWebhook({
      ...input,
      secret: SECRET,
      stripe: { webhooks: sdk.webhooks, subscriptions: { retrieve } },
      store,
      logger: createLogger({ level: "debug", write: (_level, line) => lines.push(line) }),
    });
  return { run, retrieve, store, applied, lines };
}

describe("droits (entitlements)", () => {
  it("offre gratuite : limite du coach lue dans l'environnement", () => {
    const free = entitlementsFor({ email: "jeanne@exemple.test", plan: "FREE" }, {});
    expect(free).toMatchObject({ plan: "FREE", source: "free" });
    expect(hasFeature(free, "coach.unlimited")).toBe(false);
    expect(free.limits.coachMessagesPerDay).toBe(40);
    const custom = entitlementsFor(
      { email: "jeanne@exemple.test", plan: "FREE" },
      { COACH_MESSAGES_PER_DAY: "5" },
    );
    expect(custom.limits.coachMessagesPerDay).toBe(5);
  });

  it("Premium : coach illimité", () => {
    const premium = entitlementsFor(
      { email: "jeanne@exemple.test", plan: "PREMIUM" },
      { COACH_MESSAGES_PER_DAY: "5" },
    );
    expect(premium).toMatchObject({ plan: "PREMIUM", source: "subscription" });
    expect(hasFeature(premium, "coach.unlimited")).toBe(true);
    expect(premium.limits.coachMessagesPerDay).toBeNull();
  });

  it("les adresses de ADMIN_EMAILS sont Premium sans abonnement", () => {
    const env = { ADMIN_EMAILS: "Gerant@Exemple.test, autre@exemple.test" };
    const admin = entitlementsFor({ email: "gerant@exemple.test", plan: "FREE" }, env);
    expect(admin).toMatchObject({ plan: "PREMIUM", source: "admin" });
    expect(admin.limits.coachMessagesPerDay).toBeNull();
    expect(entitlementsFor({ email: "jeanne@exemple.test", plan: "FREE" }, env).plan).toBe("FREE");
    // Compte introuvable (adresse vide) : jamais administrateur.
    expect(entitlementsFor({ email: "", plan: "FREE" }, { ADMIN_EMAILS: "" }).plan).toBe("FREE");
  });
});

describe("configuration Stripe", () => {
  it("indisponible tant que les trois variables ne sont pas renseignées", () => {
    expect(billingConfigFromEnv({})).toBeNull();
    expect(
      isBillingConfigured({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" }),
    ).toBe(false);
    expect(
      billingConfigFromEnv({
        STRIPE_SECRET_KEY: " sk_test_x ",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
        STRIPE_PRICE_PREMIUM_MONTHLY: "price_x",
      }),
    ).toEqual({ secretKey: "sk_test_x", webhookSecret: "whsec_x", pricePremiumMonthly: "price_x" });
  });
});

describe("état d'abonnement → offre", () => {
  it("Premium tant que l'abonnement est actif, en essai ou en relance de paiement", () => {
    expect(planForStatus("ACTIVE")).toBe("PREMIUM");
    expect(planForStatus("TRIALING")).toBe("PREMIUM");
    expect(planForStatus("PAST_DUE")).toBe("PREMIUM");
    for (const status of ["CANCELED", "UNPAID", "INCOMPLETE", "INCOMPLETE_EXPIRED", "PAUSED"]) {
      expect(planForStatus(status as "CANCELED")).toBe("FREE");
    }
  });

  it("lit la fin de période sur les lignes de l'abonnement", () => {
    expect(syncFromSubscription(subscription())).toEqual({
      userId: "user_fixture",
      customerId: "cus_fixture",
      subscriptionId: "sub_fixture",
      status: "ACTIVE",
      plan: "PREMIUM",
      currentPeriodEnd: new Date(1793952000 * 1000),
      cancelAtPeriodEnd: false,
    });
    const noMetadata = subscription({ metadata: {} });
    expect(syncFromSubscription(noMetadata, "user_hint").userId).toBe("user_hint");
  });
});

describe("webhook Stripe", () => {
  it("checkout.session.completed : relit l'abonnement chez Stripe et passe Premium", async () => {
    const { run, retrieve, applied } = setup();
    const result = await run(signed("checkout.session.completed"));
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(retrieve).toHaveBeenCalledWith("sub_fixture");
    expect(applied).toEqual([
      expect.objectContaining({ userId: "user_fixture", plan: "PREMIUM", status: "ACTIVE" }),
    ]);
  });

  it("un évènement rejoué est sans effet", async () => {
    const { run, retrieve, store, applied } = setup();
    const event = signed("checkout.session.completed");
    await run(event);
    const replay = await run(event);
    expect(replay.status).toBe(200);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(store.apply).toHaveBeenCalledTimes(1);
    expect(applied).toHaveLength(1);
  });

  it("signature invalide ou absente → 400, rien n'est traité", async () => {
    const { run, retrieve, store, lines } = setup();
    const forged = signed("checkout.session.completed", "whsec_autre_secret");
    expect(await run(forged)).toEqual({ status: 400, body: { error: "invalidSignature" } });
    const tampered = signed("checkout.session.completed");
    expect(
      (await run({ ...tampered, payload: tampered.payload.replace("user_fixture", "intrus") }))
        .status,
    ).toBe(400);
    expect(await run({ payload: fixture("checkout.session.completed"), signature: null })).toEqual({
      status: 400,
      body: { error: "missingSignature" },
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(store.apply).not.toHaveBeenCalled();
    expect(lines.join("\n")).not.toContain("user_fixture");
  });

  it("l'offre suit l'état chez Stripe, pas le contenu de l'évènement", async () => {
    // L'évènement dit « actif », mais l'abonnement a été résilié depuis : on retient Stripe.
    const { run, applied } = setup(subscription({ status: "canceled" }));
    await run(signed("customer.subscription.updated"));
    expect(applied[0]).toMatchObject({ status: "CANCELED", plan: "FREE" });
  });

  it("customer.subscription.deleted → offre gratuite", async () => {
    const { run, applied } = setup(subscription({ status: "canceled" }));
    await run(signed("customer.subscription.deleted"));
    expect(applied[0]).toMatchObject({ subscriptionId: "sub_fixture", plan: "FREE" });
  });

  it("invoice.payment_failed : statut PAST_DUE enregistré, Premium conservé pendant les relances", async () => {
    const { run, retrieve, applied } = setup(subscription({ status: "past_due" }));
    await run(signed("invoice.payment_failed"));
    expect(retrieve).toHaveBeenCalledWith("sub_fixture");
    expect(applied[0]).toMatchObject({ status: "PAST_DUE", plan: "PREMIUM" });
  });

  it("ignore les évènements non gérés (200, sans appel à Stripe)", async () => {
    const { run, retrieve, store } = setup();
    const payload = JSON.stringify({
      id: "evt_other",
      object: "event",
      type: "customer.created",
      data: { object: { id: "cus_x", object: "customer" } },
    });
    const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect((await run({ payload, signature })).status).toBe(200);
    expect(retrieve).not.toHaveBeenCalled();
    expect(store.apply).not.toHaveBeenCalled();
  });

  it("une panne chez Stripe remonte (500 côté route) sans marquer l'évènement traité", async () => {
    const { run, retrieve, store } = setup();
    retrieve.mockRejectedValueOnce(new Error("réseau indisponible"));
    const event = signed("checkout.session.completed");
    await expect(run(event)).rejects.toThrow();
    expect(await store.isProcessed("evt_checkout_completed_1")).toBe(false);
    // Nouvelle livraison par Stripe : traitée normalement.
    expect((await run(event)).status).toBe(200);
    expect(store.apply).toHaveBeenCalledTimes(1);
  });
});
