import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAiClient, createMockProvider } from "@/lib/ai";
import { createLogger } from "@/lib/logger";

// Base de test, session, fournisseur IA et Stripe simulés (aucun appel à l'API Stripe).
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "fr" }));
vi.mock("@/lib/ai/server", () => ({
  isAiConfigured: () => true,
  getAiClient: () =>
    createAiClient({
      provider: createMockProvider({ respond: () => ({ content: "D'accord." }) }),
      logger: createLogger({ write: () => {} }),
      sleep: async () => {},
      maxRetries: 0,
    }),
}));
const stripeState = { subscription: null as Stripe.Subscription | null, retrieved: 0 };
const SECRET = "whsec_test_db";
const sdk = new Stripe("sk_test_never_used");
vi.mock("@/lib/billing/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/server")>()),
  getStripe: () => ({
    webhooks: sdk.webhooks,
    subscriptions: {
      retrieve: async () => {
        stripeState.retrieved++;
        return stripeState.subscription;
      },
    },
  }),
}));

const { db } = await import("@/lib/db");
const { getCurrentUser } = await import("@/lib/auth/session");
const { prismaBillingStore } = await import("@/lib/billing/repository");
const { closeStripeCustomer } = await import("@/lib/billing/server");
const { POST: webhook } = await import("@/app/api/stripe/webhook/route");
const { POST: postMessage } = await import("@/app/api/coach/conversations/[id]/messages/route");
const coachRepo = await import("@/lib/coach/repository");

const url = process.env.TEST_DATABASE_URL;
type User = { id: string; email: string };

const tag = () => `${Date.now()}-${randomBytes(3).toString("hex")}`;

async function newUser(label: string): Promise<User> {
  return db.user.create({
    data: { email: `${label}.testard-${tag()}@exemple.test`, locale: "fr" },
  });
}

/** Évènement Stripe signé, à partir d'une fixture, pour un compte et des identifiants uniques. */
function stripeEvent(name: string, ids: { event: string; user: string; sub: string; cus: string }) {
  const payload = readFileSync(new URL(`../fixtures/stripe/${name}.json`, import.meta.url), "utf8")
    .replaceAll("user_fixture", ids.user)
    .replaceAll("sub_fixture", ids.sub)
    .replaceAll("cus_fixture", ids.cus)
    .replace(/"id": "evt_[a-z_0-9]+"/, `"id": "${ids.event}"`);
  return new Request("http://test/api/stripe/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": sdk.webhooks.generateTestHeaderString({ payload, secret: SECRET }),
    },
    body: payload,
  });
}

function subscription(ids: { user: string; sub: string; cus: string }, status: string) {
  return {
    id: ids.sub,
    object: "subscription",
    customer: ids.cus,
    status,
    cancel_at_period_end: false,
    metadata: { userId: ids.user },
    items: { object: "list", data: [{ id: "si_x", current_period_end: 1793952000 }] },
  } as unknown as Stripe.Subscription;
}

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PREMIUM_MONTHLY",
  "COACH_MESSAGES_PER_DAY",
  "ADMIN_EMAILS",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

describe.skipIf(!url)("abonnements : webhook Stripe et droits", () => {
  const users: User[] = [];

  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    process.env.STRIPE_SECRET_KEY = "sk_test_never_used";
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_test";
  });

  afterEach(() => {
    process.env.COACH_MESSAGES_PER_DAY = savedEnv.COACH_MESSAGES_PER_DAY;
    delete process.env.ADMIN_EMAILS;
    if (savedEnv.COACH_MESSAGES_PER_DAY === undefined) delete process.env.COACH_MESSAGES_PER_DAY;
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await db.$disconnect();
  });

  async function user(label: string) {
    const u = await newUser(label);
    users.push(u);
    return u;
  }

  it("les comptes sont créés en offre gratuite", async () => {
    const jeanne = await user("jeanne");
    expect(await db.user.findUnique({ where: { id: jeanne.id }, select: { plan: true } })).toEqual({
      plan: "FREE",
    });
  });

  it("checkout → Premium ; rejeu sans effet ; résiliation → gratuit", async () => {
    const jeanne = await user("jeanne");
    const ids = { user: jeanne.id, sub: `sub_${tag()}`, cus: `cus_${tag()}` };
    stripeState.subscription = subscription(ids, "active");

    const event = `evt_${tag()}`;
    const first = await webhook(stripeEvent("checkout.session.completed", { ...ids, event }));
    expect(first.status).toBe(200);
    const after = await db.user.findUniqueOrThrow({ where: { id: jeanne.id } });
    expect(after).toMatchObject({
      plan: "PREMIUM",
      subscriptionStatus: "ACTIVE",
      stripeCustomerId: ids.cus,
      stripeSubscriptionId: ids.sub,
      currentPeriodEnd: new Date(1793952000 * 1000),
    });

    // Même évènement rejoué (même si Stripe a changé entre-temps) : ignoré.
    const retrievedBefore = stripeState.retrieved;
    stripeState.subscription = subscription(ids, "canceled");
    const replay = await webhook(stripeEvent("checkout.session.completed", { ...ids, event }));
    expect(replay.status).toBe(200);
    expect(stripeState.retrieved).toBe(retrievedBefore);
    expect((await db.user.findUniqueOrThrow({ where: { id: jeanne.id } })).plan).toBe("PREMIUM");

    // Paiement échoué : statut enregistré, accès conservé pendant les relances.
    stripeState.subscription = subscription(ids, "past_due");
    await webhook(stripeEvent("invoice.payment_failed", { ...ids, event: `evt_${tag()}` }));
    expect(await db.user.findUniqueOrThrow({ where: { id: jeanne.id } })).toMatchObject({
      plan: "PREMIUM",
      subscriptionStatus: "PAST_DUE",
    });

    stripeState.subscription = subscription(ids, "canceled");
    await webhook(stripeEvent("customer.subscription.deleted", { ...ids, event: `evt_${tag()}` }));
    expect(await db.user.findUniqueOrThrow({ where: { id: jeanne.id } })).toMatchObject({
      plan: "FREE",
      subscriptionStatus: "CANCELED",
    });
  });

  it("signature invalide → 400, rien n'est enregistré", async () => {
    const jeanne = await user("jeanne");
    const ids = {
      user: jeanne.id,
      sub: `sub_${tag()}`,
      cus: `cus_${tag()}`,
      event: `evt_${tag()}`,
    };
    const request = stripeEvent("checkout.session.completed", ids);
    const forged = new Request(request, {
      headers: { "Stripe-Signature": "t=1,v1=deadbeef" },
    });
    const response = await webhook(forged);
    expect(response.status).toBe(400);
    expect(await db.stripeEvent.count({ where: { id: ids.event } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: jeanne.id } })).plan).toBe("FREE");
  });

  it("un compte ne peut pas s'approprier le client Stripe d'un autre", async () => {
    const alice = await user("alice");
    const mallory = await user("mallory");
    const cus = `cus_${tag()}`;
    await db.user.update({ where: { id: alice.id }, data: { stripeCustomerId: cus } });
    // Métadonnées désignant un autre compte déjà rattaché à un autre client : on suit le client.
    await db.user.update({
      where: { id: mallory.id },
      data: { stripeCustomerId: `cus_${tag()}` },
    });
    const ids = { user: mallory.id, sub: `sub_${tag()}`, cus };
    stripeState.subscription = subscription(ids, "active");
    await webhook(stripeEvent("customer.subscription.updated", { ...ids, event: `evt_${tag()}` }));
    expect((await db.user.findUniqueOrThrow({ where: { id: alice.id } })).plan).toBe("PREMIUM");
    expect((await db.user.findUniqueOrThrow({ where: { id: mallory.id } })).plan).toBe("FREE");
  });

  it("la fin d'un ancien abonnement n'annule pas l'abonnement en cours", async () => {
    const jeanne = await user("jeanne");
    const cus = `cus_${tag()}`;
    await db.user.update({
      where: { id: jeanne.id },
      data: { plan: "PREMIUM", stripeCustomerId: cus, stripeSubscriptionId: "sub_actuel" },
    });
    const old = { user: jeanne.id, sub: `sub_ancien_${tag()}`, cus };
    stripeState.subscription = subscription(old, "canceled");
    await webhook(stripeEvent("customer.subscription.deleted", { ...old, event: `evt_${tag()}` }));
    expect(await db.user.findUniqueOrThrow({ where: { id: jeanne.id } })).toMatchObject({
      plan: "PREMIUM",
      stripeSubscriptionId: "sub_actuel",
    });
  });

  it("livraisons simultanées du même évènement : traité une seule fois", async () => {
    const jeanne = await user("jeanne");
    const ids = { user: jeanne.id, sub: `sub_${tag()}`, cus: `cus_${tag()}` };
    const event = { id: `evt_${tag()}`, type: "customer.subscription.updated" };
    const sync = {
      userId: jeanne.id,
      customerId: ids.cus,
      subscriptionId: ids.sub,
      status: "ACTIVE" as const,
      plan: "PREMIUM" as const,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => prismaBillingStore.apply(event, sync)),
    );
    expect(outcomes.filter((o) => o === "applied")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(4);
  });

  it("suppression du compte : le client Stripe est supprimé (abonnement résilié) d'abord", async () => {
    const jeanne = await user("jeanne");
    const del = vi.fn(async () => ({}) as never);
    const stripe = { customers: { del } } as never;
    // Sans client Stripe : rien à résilier.
    expect(await closeStripeCustomer(jeanne.id, stripe)).toBe(true);
    expect(del).not.toHaveBeenCalled();

    const cus = `cus_${tag()}`;
    await db.user.update({ where: { id: jeanne.id }, data: { stripeCustomerId: cus } });
    expect(await closeStripeCustomer(jeanne.id, stripe)).toBe(true);
    expect(del).toHaveBeenCalledWith(cus);

    // Stripe injoignable : la suppression du compte doit être refusée.
    del.mockRejectedValueOnce(Object.assign(new Error("panne"), { code: "api_error" }));
    expect(await closeStripeCustomer(jeanne.id, stripe)).toBe(false);
    // Client déjà supprimé chez Stripe : rien à faire.
    del.mockRejectedValueOnce(Object.assign(new Error("absent"), { code: "resource_missing" }));
    expect(await closeStripeCustomer(jeanne.id, stripe)).toBe(true);
  });

  describe("coach : limite selon l'offre", () => {
    function send(conversationId: string, content: string) {
      return postMessage(
        new Request(`http://test/api/coach/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }),
        { params: Promise.resolve({ id: conversationId }) },
      );
    }

    async function sendMany(u: User, count: number) {
      vi.mocked(getCurrentUser).mockResolvedValue(u);
      const { id } = await coachRepo.createConversation(u.id, "INTERVIEW");
      const statuses: number[] = [];
      const lastEvents: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const response = await send(id, `message ${i}`);
        statuses.push(response.status);
        if (response.ok) {
          const lines = (await response.text()).split("\n").filter(Boolean);
          lastEvents.push(JSON.parse(lines.at(-1)!));
        } else {
          lastEvents.push(await response.json());
        }
      }
      return { statuses, lastEvents };
    }

    it("gratuit : limite appliquée ; Premium : illimité", async () => {
      process.env.COACH_MESSAGES_PER_DAY = "2";
      const free = await user("gratuit");
      const { statuses, lastEvents } = await sendMany(free, 3);
      expect(statuses).toEqual([200, 200, 429]);
      expect(lastEvents[2]).toEqual({ error: "quotaExceeded", limit: 2 });

      const premium = await user("premium");
      await db.user.update({ where: { id: premium.id }, data: { plan: "PREMIUM" } });
      const unlimited = await sendMany(premium, 4);
      expect(unlimited.statuses).toEqual([200, 200, 200, 200]);
      expect(unlimited.lastEvents.at(-1)).toMatchObject({ type: "done", remaining: null });
    });

    it("coach réservé à Premium (limite 0) ; administrateurs Premium d'office", async () => {
      process.env.COACH_MESSAGES_PER_DAY = "0";
      const free = await user("gratuit");
      expect((await sendMany(free, 1)).statuses).toEqual([429]);

      const admin = await user("gerant");
      process.env.ADMIN_EMAILS = admin.email.toUpperCase();
      expect((await sendMany(admin, 2)).statuses).toEqual([200, 200]);
    });
  });
});
