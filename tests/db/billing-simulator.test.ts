import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Base de test et session simulées. Aucune variable de facturation : simulateur par défaut.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "fr" }));

const { db } = await import("@/lib/db");
const { requireUser } = await import("@/lib/auth/session");
const { getEntitlements } = await import("@/lib/billing/server");
const { simulatorProvider, cancelBillingForAccountDeletion } =
  await import("@/lib/billing/provider");
const sim = await import("@/lib/billing/simulator-server");
const { completeSimulatedCheckout, simulatedPortalAction } =
  await import("@/app/[locale]/app/billing/simulation/actions");
const { adminSimulatorAction, findBillingUser } =
  await import("@/app/[locale]/app/simulateur-paiement/actions");
const { startCheckout } = await import("@/app/[locale]/app/billing/actions");

const url = process.env.TEST_DATABASE_URL;
type User = { id: string; email: string };

const tag = () => `${Date.now()}-${randomBytes(3).toString("hex")}`;

/** Issue d'une action serveur : redirection (URL) ou page introuvable (404). */
async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "returned";
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2]!;
    if (digest.includes("404")) return "404";
    throw error;
  }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

const BILLING_ENV = [
  "BILLING_PROVIDER",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PREMIUM_MONTHLY",
  "ADMIN_EMAILS",
] as const;
const savedEnv = Object.fromEntries(BILLING_ENV.map((k) => [k, process.env[k]]));

describe.skipIf(!url)("simulateur de paiement (sans aucune variable de facturation)", () => {
  const users: User[] = [];

  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    for (const key of BILLING_ENV) delete process.env[key];
  });

  beforeEach(() => {
    delete process.env.BILLING_PROVIDER;
    delete process.env.ADMIN_EMAILS;
  });

  afterAll(async () => {
    for (const key of BILLING_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await db.$disconnect();
  });

  async function user(label: string): Promise<User> {
    const u = await db.user.create({
      data: { email: `${label}.sim-${tag()}@exemple.test`, locale: "fr" },
    });
    users.push(u);
    return u;
  }

  const as = (u: User) => vi.mocked(requireUser).mockResolvedValue(u);
  const account = (u: User) => db.user.findUniqueOrThrow({ where: { id: u.id } });

  /** « Passer à Premium » puis « Payer (succès) » sur la page simulée. */
  async function upgrade(u: User) {
    as(u);
    const checkout = await outcome(startCheckout());
    expect(checkout).toMatch(/^\/fr\/app\/billing\/simulation\/paiement\/sim_cs_/);
    const session = checkout.split("/").at(-1)!;
    const paid = await outcome(completeSimulatedCheckout(form({ session, outcome: "success" })));
    expect(paid).toBe("/fr/app/billing?checkout=success");
    return session;
  }

  it("souscription → coach illimité ; identifiants sim_ ; même journal d'évènements", async () => {
    const jeanne = await user("jeanne");
    expect((await getEntitlements(jeanne.id)).limits.coachMessagesPerDay).not.toBeNull();

    await upgrade(jeanne);
    const after = await account(jeanne);
    expect(after).toMatchObject({ plan: "PREMIUM", subscriptionStatus: "ACTIVE" });
    expect(after.stripeCustomerId).toMatch(/^sim_cus_/);
    expect(after.stripeSubscriptionId).toMatch(/^sim_sub_/);
    expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    const entitlements = await getEntitlements(jeanne.id);
    expect(entitlements).toMatchObject({ plan: "PREMIUM", source: "subscription" });
    expect(entitlements.limits.coachMessagesPerDay).toBeNull();
    // Évènements enregistrés comme ceux de Stripe (idempotence).
    expect(
      await db.stripeEvent.count({ where: { id: { startsWith: "sim_evt_" } } }),
    ).toBeGreaterThan(0);

    // Déjà Premium : pas de second paiement.
    expect(await outcome(startCheckout())).toBe("/fr/app/billing");
  });

  it("carte refusée ou paiement annulé : rien ne change", async () => {
    const paul = await user("paul");
    as(paul);
    const session = (await outcome(startCheckout())).split("/").at(-1)!;
    expect(await outcome(completeSimulatedCheckout(form({ session, outcome: "declined" })))).toBe(
      `/fr/app/billing/simulation/paiement/${session}?refus=1`,
    );
    expect(await account(paul)).toMatchObject({ plan: "FREE", stripeCustomerId: null });
    expect(await outcome(completeSimulatedCheckout(form({ session, outcome: "cancel" })))).toBe(
      "/fr/app/billing?checkout=cancel",
    );
    expect(await sim.getSimulatedCheckout(paul.id, session)).toBeNull();
    expect((await account(paul)).plan).toBe("FREE");
  });

  it("résiliation à l'échéance : Premium jusqu'à la fin de période, puis gratuit", async () => {
    const jeanne = await user("jeanne");
    await upgrade(jeanne);
    expect(await outcome(simulatedPortalAction(form({ action: "cancelAtPeriodEnd" })))).toBe(
      "/fr/app/billing/simulation/portail?fait=cancelAtPeriodEnd",
    );
    expect(await account(jeanne)).toMatchObject({ plan: "PREMIUM", cancelAtPeriodEnd: true });

    // Reprise, puis nouvelle résiliation.
    await outcome(simulatedPortalAction(form({ action: "resume" })));
    expect((await account(jeanne)).cancelAtPeriodEnd).toBe(false);
    await outcome(simulatedPortalAction(form({ action: "cancelAtPeriodEnd" })));

    // Échéance passée : appliquée à la lecture des droits, comme Stripe l'aurait fait.
    const end = (await account(jeanne)).currentPeriodEnd!;
    await sim.settleDueSimulatedSubscription(jeanne.id, new Date(end.getTime() + 1000));
    expect(await account(jeanne)).toMatchObject({ plan: "FREE", subscriptionStatus: "CANCELED" });
    expect((await getEntitlements(jeanne.id)).plan).toBe("FREE");
  });

  it("retour immédiat à l'offre gratuite depuis le portail", async () => {
    const jeanne = await user("jeanne");
    await upgrade(jeanne);
    await outcome(simulatedPortalAction(form({ action: "cancelNow" })));
    expect(await account(jeanne)).toMatchObject({ plan: "FREE", subscriptionStatus: "CANCELED" });
    // Action sans objet : refusée proprement.
    expect(await outcome(simulatedPortalAction(form({ action: "resume" })))).toBe(
      "/fr/app/billing/simulation/portail?erreur=resume",
    );
    // Nouvelle souscription possible ensuite (même client simulé).
    const customer = (await account(jeanne)).stripeCustomerId;
    await upgrade(jeanne);
    expect(await account(jeanne)).toMatchObject({ plan: "PREMIUM", stripeCustomerId: customer });
  });

  it("renouvellement refusé : relances (Premium conservé), puis retour au gratuit", async () => {
    const jeanne = await user("jeanne");
    await upgrade(jeanne);
    expect(await sim.applySimulatorAction(jeanne.id, "failRenewal")).toBe("ok");
    expect(await account(jeanne)).toMatchObject({
      plan: "PREMIUM",
      subscriptionStatus: "PAST_DUE",
    });
    expect(await sim.applySimulatorAction(jeanne.id, "periodEnd")).toBe("ok");
    expect(await account(jeanne)).toMatchObject({ plan: "FREE", subscriptionStatus: "UNPAID" });
  });

  it("isolation : la session de paiement d'un autre compte est introuvable (404)", async () => {
    const alice = await user("alice");
    const mallory = await user("mallory");
    as(alice);
    const session = (await outcome(startCheckout())).split("/").at(-1)!;

    as(mallory);
    for (const outcomeName of ["success", "declined", "cancel"]) {
      expect(
        await outcome(completeSimulatedCheckout(form({ session, outcome: outcomeName }))),
      ).toBe("404");
    }
    expect(await sim.applySimulatorAction(mallory.id, "pay", { checkoutSessionId: session })).toBe(
      "notFound",
    );
    expect((await account(mallory)).plan).toBe("FREE");
    expect((await account(alice)).plan).toBe("FREE");
    // La session d'Alice est intacte : elle peut toujours payer.
    expect(await sim.getSimulatedCheckout(alice.id, session)).not.toBeNull();

    // Le portail n'agit que sur l'abonnement du compte connecté.
    await upgrade(alice);
    as(mallory);
    expect(await outcome(simulatedPortalAction(form({ action: "cancelNow" })))).toBe(
      "/fr/app/billing/simulation/portail?erreur=cancelNow",
    );
    expect((await account(alice)).plan).toBe("PREMIUM");
  });

  it("hors simulateur, ses actions n'existent pas (404)", async () => {
    const jeanne = await user("jeanne");
    as(jeanne);
    process.env.BILLING_PROVIDER = "stripe";
    expect(await outcome(simulatedPortalAction(form({ action: "cancelNow" })))).toBe("404");
    // Stripe demandé sans clés : paiements indisponibles, sans plantage.
    expect(await outcome(startCheckout())).toBe("/fr/app/billing?error=checkout");
  });

  it("contrôles d'administration : réservés aux administrateurs", async () => {
    const gerant = await user("gerant");
    const jeanne = await user("jeanne");
    process.env.ADMIN_EMAILS = gerant.email;

    // Non-administrateur : la page et ses actions n'existent pas.
    as(jeanne);
    expect(
      await outcome(adminSimulatorAction(form({ userId: jeanne.id, action: "forcePremium" }))),
    ).toBe("404");
    expect(await outcome(findBillingUser(form({ email: jeanne.email })))).toBe("404");
    expect((await account(jeanne)).plan).toBe("FREE");

    as(gerant);
    expect(await outcome(findBillingUser(form({ email: jeanne.email.toUpperCase() })))).toBe(
      `/fr/app/simulateur-paiement?u=${jeanne.id}`,
    );
    const run = (action: string) =>
      outcome(adminSimulatorAction(form({ userId: jeanne.id, action })));

    expect(await run("forcePremium")).toBe(
      `/fr/app/simulateur-paiement?u=${jeanne.id}&fait=forcePremium`,
    );
    expect(await account(jeanne)).toMatchObject({ plan: "PREMIUM", subscriptionStatus: "ACTIVE" });
    const firstEnd = (await account(jeanne)).currentPeriodEnd!;

    // Fin de période : renouvellement payé, nouvelle échéance.
    await run("periodEnd");
    expect((await account(jeanne)).plan).toBe("PREMIUM");
    expect((await account(jeanne)).currentPeriodEnd!.getTime()).toBeGreaterThanOrEqual(
      firstEnd.getTime(),
    );

    await run("failRenewal");
    expect((await account(jeanne)).subscriptionStatus).toBe("PAST_DUE");
    await run("periodEnd");
    expect(await account(jeanne)).toMatchObject({ plan: "FREE", subscriptionStatus: "UNPAID" });

    await run("forcePremium");
    expect((await account(jeanne)).plan).toBe("PREMIUM");
    await run("forceFree");
    expect(await account(jeanne)).toMatchObject({ plan: "FREE", subscriptionStatus: "CANCELED" });
    expect(await run("failRenewal")).toBe(
      `/fr/app/simulateur-paiement?u=${jeanne.id}&erreur=failRenewal`,
    );
  });

  it("suppression du compte : abonnement simulé résilié, sans appel à Stripe", async () => {
    const jeanne = await user("jeanne");
    await upgrade(jeanne);
    expect(await cancelBillingForAccountDeletion(jeanne.id)).toBe(true);
    expect((await account(jeanne)).plan).toBe("FREE");
    expect(simulatorProvider.canManage(await account(jeanne))).toBe(true);
  });
});
