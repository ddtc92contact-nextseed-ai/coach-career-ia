import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  billingMode,
  isBillingAvailable,
  isSimulatedId,
  simulatedPriceFromEnv,
} from "@/lib/billing/config";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { getBillingProvider } from "@/lib/billing/provider";
import {
  addOneMonth,
  deliverSimulatorEvents,
  isDue,
  simulatorEvent,
  toStripeSubscription,
  transition,
  type SimEventType,
  type SimSubscription,
} from "@/lib/billing/simulator";
import {
  handleStripeWebhook,
  syncFromSubscription,
  type BillingStore,
  type SubscriptionSync,
} from "@/lib/billing/webhook";
import { createLogger } from "@/lib/logger";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/stripe/${name}.json`, import.meta.url), "utf8");

const silent = createLogger({ write: () => {} });
const NOW = new Date("2026-10-07T10:00:00Z");

function sim(overrides: Partial<SimSubscription> = {}): SimSubscription {
  return {
    id: "sim_sub_1",
    userId: "user_fixture",
    customerId: "sim_cus_1",
    checkoutSessionId: "sim_cs_1",
    status: "ACTIVE",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(1793952000 * 1000),
    ...overrides,
  };
}

function memoryStore() {
  const events = new Set<string>();
  const applied: SubscriptionSync[] = [];
  const store: BillingStore = {
    isProcessed: async (id) => events.has(id),
    apply: async (event, sync) => {
      if (events.has(event.id)) return "duplicate";
      events.add(event.id);
      if (sync) applied.push(sync);
      return "applied";
    },
  };
  return { store, applied };
}

/** Structure d'un objet JSON (clés et types), sans les valeurs. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : [];
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shape(v)]),
    );
  }
  return value === null ? null : typeof value;
}

describe("choix du fournisseur (BILLING_PROVIDER)", () => {
  const keys = {
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_PREMIUM_MONTHLY: "price_x",
  };

  it("simulateur par défaut, sans aucune variable de facturation", () => {
    expect(billingMode({})).toBe("simulator");
    expect(billingMode({ BILLING_PROVIDER: " Simulator " })).toBe("simulator");
    // Les clés Stripe seules ne suffisent pas : il faut le demander explicitement.
    expect(billingMode(keys)).toBe("simulator");
    expect(isBillingAvailable({})).toBe(true);
  });

  it("Stripe seulement si demandé ET configuré", () => {
    expect(billingMode({ ...keys, BILLING_PROVIDER: "stripe" })).toBe("stripe");
    expect(billingMode({ BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_x" })).toBe(
      "unavailable",
    );
    expect(billingMode({ BILLING_PROVIDER: "stripe" })).toBe("unavailable");
    expect(isBillingAvailable({ BILLING_PROVIDER: "stripe" })).toBe(false);
    // Valeur inconnue : jamais de simulation par erreur.
    expect(billingMode({ BILLING_PROVIDER: "paypal" })).toBe("unavailable");
  });

  it("le fournisseur suit le mode ; Stripe sans clés → paiements indisponibles", () => {
    expect(getBillingProvider("simulator")?.name).toBe("simulator");
    expect(getBillingProvider("stripe")?.name).toBe("stripe");
    expect(getBillingProvider("unavailable")).toBeNull();
  });

  describe("environnement du processus", () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it("BILLING_PROVIDER=stripe sans clés : aucun fournisseur, aucune erreur", () => {
      process.env.BILLING_PROVIDER = "stripe";
      delete process.env.STRIPE_SECRET_KEY;
      expect(() => getBillingProvider()).not.toThrow();
      expect(getBillingProvider()).toBeNull();
      delete process.env.BILLING_PROVIDER;
      expect(getBillingProvider()?.name).toBe("simulator");
    });
  });

  it("chaque fournisseur ne gère que ses propres clients", () => {
    const simulator = getBillingProvider("simulator")!;
    const stripe = getBillingProvider("stripe")!;
    expect(simulator.canManage({ stripeCustomerId: "sim_cus_1" })).toBe(true);
    expect(simulator.canManage({ stripeCustomerId: "cus_real" })).toBe(false);
    expect(stripe.canManage({ stripeCustomerId: "cus_real" })).toBe(true);
    expect(stripe.canManage({ stripeCustomerId: "sim_cus_1" })).toBe(false);
    expect(stripe.canManage({ stripeCustomerId: null })).toBe(false);
    expect(isSimulatedId("sim_x")).toBe(true);
    expect(isSimulatedId(null)).toBe(false);
  });
});

describe("prix simulé", () => {
  it("9,00 EUR par mois par défaut, sinon lu dans l'environnement", () => {
    expect(simulatedPriceFromEnv({})).toEqual({ amount: 9, currency: "EUR", interval: "month" });
    expect(
      simulatedPriceFromEnv({ BILLING_PREMIUM_PRICE_CENTS: "1490", BILLING_CURRENCY: "chf" }),
    ).toEqual({ amount: 14.9, currency: "CHF", interval: "month" });
    expect(
      simulatedPriceFromEnv({ BILLING_PREMIUM_PRICE_CENTS: "abc", BILLING_CURRENCY: "euro" }),
    ).toEqual({ amount: 9, currency: "EUR", interval: "month" });
  });
});

describe("évènements simulés = évènements Stripe", () => {
  const pairs: [SimEventType, string][] = [
    ["checkout.session.completed", "checkout.session.completed"],
    ["customer.subscription.updated", "customer.subscription.updated"],
    ["customer.subscription.deleted", "customer.subscription.deleted"],
    ["invoice.payment_failed", "invoice.payment_failed"],
  ];

  it.each(pairs)("%s : même forme que la fixture Stripe", (type, name) => {
    const stripe = JSON.parse(fixture(name));
    const simulated = simulatorEvent(type, sim({ currentPeriodEnd: null }), NOW);
    expect(simulated.type).toBe(stripe.type);
    expect(shape(simulated)).toEqual(shape(stripe));
    // Identifiants préfixés `sim_` : jamais confondus avec ceux de Stripe.
    expect(simulated.id).toMatch(/^sim_evt_/);
  });

  it("l'abonnement relu a la même forme que celui de l'API Stripe", () => {
    const stripe = JSON.parse(fixture("subscription"));
    expect(shape(toStripeSubscription(sim()))).toEqual(shape(stripe));
    expect(syncFromSubscription(toStripeSubscription(sim()))).toEqual(
      syncFromSubscription({
        ...stripe,
        id: "sim_sub_1",
        customer: "sim_cus_1",
      } as Stripe.Subscription),
    );
  });

  it.each([
    ["active", "ACTIVE"],
    ["past_due", "PAST_DUE"],
    ["canceled", "CANCELED"],
    ["unpaid", "UNPAID"],
  ] as const)("statut %s : mêmes droits que via Stripe", async (stripeStatus, simStatus) => {
    const SECRET = "whsec_unit";
    const sdk = new Stripe("sk_test_never_used");
    const stripeSub = {
      ...JSON.parse(fixture("subscription")),
      status: stripeStatus,
    } as Stripe.Subscription;

    // Voie Stripe : fixture signée, abonnement relu chez « Stripe ».
    const viaStripe = memoryStore();
    const payload = fixture("customer.subscription.updated");
    await handleStripeWebhook({
      payload,
      signature: sdk.webhooks.generateTestHeaderString({ payload, secret: SECRET }),
      secret: SECRET,
      stripe: { webhooks: sdk.webhooks, subscriptions: { retrieve: async () => stripeSub } },
      store: viaStripe.store,
      logger: silent,
    });

    // Voie simulateur : même traitement, abonnement relu dans l'état simulé.
    const viaSimulator = memoryStore();
    const subscription = sim({ status: simStatus });
    await deliverSimulatorEvents({
      events: [simulatorEvent("customer.subscription.updated", subscription, NOW)],
      lookup: async (id) => (id === subscription.id ? subscription : null),
      store: viaSimulator.store,
      logger: silent,
    });

    const [a] = viaStripe.applied;
    const [b] = viaSimulator.applied;
    expect(b).toEqual({ ...a, customerId: "sim_cus_1", subscriptionId: "sim_sub_1" });
    const account = (plan: "FREE" | "PREMIUM") => ({ email: "jeanne@exemple.test", plan });
    expect(entitlementsFor(account(b!.plan), {})).toEqual(entitlementsFor(account(a!.plan), {}));
  });
});

describe("transitions du simulateur", () => {
  const live = { status: "ACTIVE" as const, cancelAtPeriodEnd: false, currentPeriodEnd: NOW };

  it("paiement accepté : actif un mois, abonnement créé puis paiement terminé", () => {
    const step = transition({ ...live, status: "INCOMPLETE", currentPeriodEnd: null }, "pay", NOW);
    expect(step).toEqual({
      next: { status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: addOneMonth(NOW) },
      events: ["customer.subscription.created", "checkout.session.completed"],
    });
    expect(transition(live, "pay", NOW)).toBeNull();
  });

  it("résiliation à l'échéance, reprise, retour immédiat au gratuit", () => {
    const canceling = transition(live, "cancelAtPeriodEnd", NOW)!;
    expect(canceling.next.cancelAtPeriodEnd).toBe(true);
    expect(transition({ ...live, cancelAtPeriodEnd: true }, "cancelAtPeriodEnd")).toBeNull();
    expect(transition({ ...live, cancelAtPeriodEnd: true }, "resume")!.next).toMatchObject({
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
    });
    expect(transition(live, "resume")).toBeNull();
    expect(transition(live, "cancelNow")).toMatchObject({
      next: { status: "CANCELED" },
      events: ["customer.subscription.deleted"],
    });
    expect(transition({ ...live, status: "CANCELED" }, "cancelNow")).toBeNull();
  });

  it("échéance : renouvellement, fin d'un abonnement résilié, relances épuisées", () => {
    expect(transition(live, "periodEnd", NOW)).toEqual({
      next: { status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: addOneMonth(NOW) },
      events: ["customer.subscription.updated"],
    });
    expect(transition({ ...live, cancelAtPeriodEnd: true }, "periodEnd")).toMatchObject({
      next: { status: "CANCELED" },
      events: ["customer.subscription.deleted"],
    });
    expect(transition({ ...live, status: "PAST_DUE" }, "periodEnd")).toMatchObject({
      next: { status: "UNPAID" },
      events: ["customer.subscription.updated"],
    });
    expect(transition({ ...live, status: "CANCELED" }, "periodEnd")).toBeNull();
  });

  it("renouvellement refusé : relances (PAST_DUE), puis régularisation possible", () => {
    expect(transition(live, "failRenewal", NOW)).toEqual({
      next: { status: "PAST_DUE", cancelAtPeriodEnd: false, currentPeriodEnd: addOneMonth(NOW) },
      events: ["invoice.payment_failed", "customer.subscription.updated"],
    });
    // Abonnement résilié : pas de renouvellement, donc pas d'échec possible.
    expect(transition({ ...live, cancelAtPeriodEnd: true }, "failRenewal")).toBeNull();
    expect(transition({ ...live, status: "PAST_DUE" }, "payOutstanding")!.next.status).toBe(
      "ACTIVE",
    );
    expect(transition(live, "payOutstanding")).toBeNull();
  });

  it("échéance passée : seulement pour un abonnement en cours", () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(isDue({ status: "ACTIVE", currentPeriodEnd: past }, NOW)).toBe(true);
    expect(isDue({ status: "PAST_DUE", currentPeriodEnd: past }, NOW)).toBe(true);
    expect(isDue({ status: "CANCELED", currentPeriodEnd: past }, NOW)).toBe(false);
    expect(isDue({ status: "ACTIVE", currentPeriodEnd: addOneMonth(NOW) }, NOW)).toBe(false);
  });
});

describe("parcours complet via le traitement du webhook", () => {
  it("souscription → résiliation à l'échéance → gratuit ; échec de renouvellement → gratuit", async () => {
    const { store, applied } = memoryStore();
    let state = sim({ status: "INCOMPLETE", currentPeriodEnd: null });
    const lookup = vi.fn(async () => state);

    async function act(action: Parameters<typeof transition>[1], now = NOW) {
      const step = transition(state, action, now);
      expect(step, action).not.toBeNull();
      state = { ...state, ...step!.next };
      const results = await deliverSimulatorEvents({
        events: step!.events.map((type) => simulatorEvent(type, state, now)),
        lookup,
        store,
        logger: silent,
      });
      for (const r of results) expect(r).toEqual({ status: 200, body: { received: true } });
      return applied.at(-1)!;
    }

    expect(await act("pay")).toMatchObject({
      userId: "user_fixture",
      plan: "PREMIUM",
      status: "ACTIVE",
    });
    expect(applied).toHaveLength(2);
    expect(await act("cancelAtPeriodEnd")).toMatchObject({
      plan: "PREMIUM",
      cancelAtPeriodEnd: true,
    });
    expect(await act("periodEnd")).toMatchObject({ plan: "FREE", status: "CANCELED" });

    state = sim({ id: "sim_sub_2", status: "INCOMPLETE", currentPeriodEnd: null });
    await act("pay");
    expect(await act("failRenewal")).toMatchObject({ plan: "PREMIUM", status: "PAST_DUE" });
    expect(await act("periodEnd")).toMatchObject({ plan: "FREE", status: "UNPAID" });
  });
});
