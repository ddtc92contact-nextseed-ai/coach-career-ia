import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Base de test et session simulée : le code applicatif est exécuté tel quel.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Géocodage simulé : « Paris » est connue, le reste introuvable.
vi.mock("@/lib/geo/server", () => ({
  locateLabels: vi.fn(async (labels: string[]) =>
    labels.map((l) => (l === "Paris" ? { latitude: 48.8566, longitude: 2.3522 } : null)),
  ),
  locateOfferPlace: vi.fn(async (place: { city: string }, now: Date = new Date()) =>
    place.city === "Paris"
      ? { latitude: 48.8566, longitude: 2.3522, geocodedAt: now }
      : { latitude: null, longitude: null, geocodedAt: now },
  ),
}));

const { db } = await import("@/lib/db");
const { requireUser } = await import("@/lib/auth/session");
const employer = await import("@/lib/employer/repository");
const { requireEmployer } = await import("@/lib/employer/session");
const admin = await import("@/lib/employer/admin");
const { expireDirectPostings } = await import("@/lib/employer/publication");
const { paySimulatedJobPosting, getSimulatedJobPostingCheckout } =
  await import("@/lib/billing/simulator-server");
const career = await import("@/lib/career/repository");
const { recomputeUserMatches } = await import("@/lib/matching/recompute");
const { matchingConfig } = await import("@/lib/matching/config");
const { getMatch, markMatchSeen } = await import("@/lib/matching/repository");
const { default: EmployerDashboardPage } = await import("@/app/[locale]/entreprise/(espace)/page");
const { default: PostingPage } =
  await import("@/app/[locale]/entreprise/(espace)/offres/[id]/page");

const url = process.env.TEST_DATABASE_URL;
const run = `e${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;
const DAY = 86_400_000;

type TestUser = { id: string; email: string };

async function newUser(email: string): Promise<TestUser> {
  return db.user.create({ data: { email, locale: "fr" }, select: { id: true, email: true } });
}

function signIn(user: TestUser) {
  vi.mocked(requireUser).mockResolvedValue(user);
}

const orgInput = (name: string, website: string) => ({
  name,
  website,
  sector: "SAAS_SOFTWARE" as const,
  size: "S51_200" as const,
  country: "FR" as const,
});

const postingInput = (overrides: Record<string, unknown> = {}) => ({
  title: "Data engineer senior",
  description:
    "Vous rejoignez l’équipe data pour fiabiliser nos pipelines Python, SQL et Airflow, " +
    "industrialiser les modèles dbt et accompagner les analystes. Télétravail deux jours par " +
    "semaine, équipe de huit personnes, stack moderne sur Postgres et dbt.",
  contractType: "CDI" as const,
  remotePolicy: "HYBRID" as const,
  city: "Paris",
  country: "FR" as const,
  seniority: "SENIOR" as const,
  sector: "SAAS_SOFTWARE" as const,
  salaryMin: 60000,
  salaryMax: 70000,
  salaryCurrency: "EUR" as const,
  salaryPeriod: "YEAR" as const,
  ...overrides,
});

async function membership(user: TestUser) {
  const m = await employer.getMembership(user.id);
  if (!m) throw new Error("membre attendu");
  return m.organization;
}

/** Soumet puis paie (simulateur) une offre ; renvoie son statut. */
async function submitAndPay(user: TestUser, postingId: string) {
  const org = await membership(user);
  const submitted = await employer.submitPosting(org.id, postingId);
  expect(submitted.ok).toBe(true);
  const checkout = await employer.startPostingCheckout(user, org, postingId, "fr");
  if (!checkout.ok || checkout.redirect.kind !== "internal") throw new Error("paiement attendu");
  const session = checkout.redirect.href.split("/").at(-1)!;
  expect(await paySimulatedJobPosting(user.id, session)).toBe("ok");
  return db.jobPosting.findUniqueOrThrow({
    where: { id: postingId },
    select: { status: true, expiresAt: true, offer: { select: { status: true } } },
  });
}

describe.skipIf(!url)("espace entreprise : comptes, offres, paiement, modération", () => {
  let acme: TestUser; // domaine vérifié
  let webmail: TestUser; // messagerie grand public → en attente
  let globex: TestUser; // autre organisation (IDOR)
  let candidate: TestUser; // candidat uniquement
  let picky: TestUser; // candidat dont les garde-fous excluent l'offre
  const sent: { to: string; subject: string; text: string }[] = [];
  const deps = {
    send: async (m: { to: string; subject: string; text: string }) => {
      sent.push(m);
    },
    appUrl: "https://app.exemple.test",
  };

  beforeAll(async () => {
    delete process.env.BILLING_PROVIDER;
    process.env.ADMIN_EMAILS = "";
    process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    acme = await newUser(`rh-${run}@acme-${run}.test`);
    webmail = await newUser(`recruteur.${run}@gmail.com`);
    globex = await newUser(`rh-${run}@globex-${run}.test`);
    candidate = await newUser(`candidat-${run}@exemple.test`);
    picky = await newUser(`exigeant-${run}@exemple.test`);
  });

  afterAll(async () => {
    const users = [acme, webmail, globex, candidate, picky].filter(Boolean).map((u) => u.id);
    const orgs = await db.organization.findMany({
      where: { members: { some: { userId: { in: users } } } },
      select: { id: true, companyId: true },
    });
    await db.jobOffer.deleteMany({ where: { companyId: { in: orgs.map((o) => o.companyId) } } });
    await db.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
    await db.company.deleteMany({ where: { id: { in: orgs.map((o) => o.companyId) } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  it("inscription : domaine vérifié → active ; webmail → en attente", async () => {
    const verified = await employer.createOrganization(
      acme,
      orgInput("Acme", `https://www.acme-${run}.test`),
    );
    expect(verified).toMatchObject({ ok: true, status: "ACTIVE" });
    const pending = await employer.createOrganization(
      webmail,
      orgInput("Initech", `https://initech-${run}.test`),
    );
    expect(pending).toMatchObject({ ok: true, status: "PENDING" });
    await employer.createOrganization(globex, orgInput("Globex", `https://globex-${run}.test`));

    const org = await membership(acme);
    expect(org).toMatchObject({ status: "ACTIVE", domain: `acme-${run}.test` });
    expect(org.verifiedAt).toBeInstanceOf(Date);
    const company = await db.company.findUniqueOrThrow({ where: { id: org.companyId } });
    expect(company.name).toBe("Acme");
    // Une seule organisation par compte (v1).
    expect(
      await employer.createOrganization(acme, orgInput("Acme 2", `https://acme-${run}.test`)),
    ).toEqual({ ok: false, error: "alreadyMember" });
  });

  it("un compte uniquement candidat n'atteint aucune page /entreprise (404)", async () => {
    signIn(candidate);
    await expect(requireEmployer()).rejects.toThrow(NOT_FOUND);
    await expect(EmployerDashboardPage()).rejects.toThrow(NOT_FOUND);
    signIn(acme);
    await expect(requireEmployer()).resolves.toMatchObject({ role: "OWNER" });
  });

  it("brouillon : offre directe hors matching tant qu'elle n'est pas publiée", async () => {
    const org = await membership(acme);
    const id = await employer.createPosting(org, postingInput());
    const posting = await db.jobPosting.findUniqueOrThrow({
      where: { id },
      include: { offer: true },
    });
    expect(posting.status).toBe("DRAFT");
    expect(posting.offer).toMatchObject({
      source: "direct",
      sourceKey: `direct:${org.id}`,
      status: "DRAFT",
      companyId: org.companyId,
      companyName: "Acme",
      latitude: 48.8566,
    });
    expect(Number(posting.offer.salaryMin)).toBe(60000);
  });

  it("IDOR : un membre de l'organisation B ne lit ni ne modifie les offres de A (404)", async () => {
    const orgA = await membership(acme);
    const orgB = await membership(globex);
    const [postingA] = await employer.listPostings(orgA.id);
    expect(postingA).toBeDefined();

    expect(await employer.getPosting(orgB.id, postingA!.id)).toBeNull();
    expect(await employer.listPostings(orgB.id)).toEqual([]);
    expect(await employer.updatePosting(orgB, postingA!.id, postingInput())).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await employer.submitPosting(orgB.id, postingA!.id)).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await employer.closePosting(orgB.id, postingA!.id)).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await employer.startPostingCheckout(globex, orgB, postingA!.id, "fr")).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await employer.deleteDraft(orgB.id, postingA!.id)).toBe(false);

    signIn(globex);
    await expect(
      PostingPage({
        params: Promise.resolve({ id: postingA!.id }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(NOT_FOUND);
  });

  it("paiement simulé → publication 30 jours ; la session d'un autre compte est introuvable", async () => {
    const org = await membership(acme);
    const [posting] = await employer.listPostings(org.id);
    await employer.submitPosting(org.id, posting!.id);
    const checkout = await employer.startPostingCheckout(acme, org, posting!.id, "fr");
    if (!checkout.ok || checkout.redirect.kind !== "internal") throw new Error("paiement attendu");
    const session = checkout.redirect.href.split("/").at(-1)!;
    expect(checkout.redirect.href).toBe(`/entreprise/paiement/${session}`);

    // Pas encore payé : toujours hors ligne.
    let row = await db.jobPosting.findUniqueOrThrow({
      where: { id: posting!.id },
      include: { offer: { select: { status: true } } },
    });
    expect(row.status).toBe("AWAITING_PAYMENT");
    expect(row.offer.status).toBe("DRAFT");

    expect(await getSimulatedJobPostingCheckout(globex.id, session)).toBeNull();
    expect(await paySimulatedJobPosting(globex.id, session)).toBe("notFound");

    const before = Date.now();
    expect(await paySimulatedJobPosting(acme.id, session)).toBe("ok");
    row = await db.jobPosting.findUniqueOrThrow({
      where: { id: posting!.id },
      include: { offer: { select: { status: true } } },
    });
    expect(row.status).toBe("LIVE");
    expect(row.offer.status).toBe("OPEN");
    expect(row.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    const payment = await db.jobPostingPayment.findFirstOrThrow({
      where: { postingId: posting!.id, status: "PAID" },
    });
    expect(payment).toMatchObject({ provider: "simulator", amountCents: 9900, currency: "EUR" });
    // Session déjà payée : rejouer ne fait rien.
    expect(await paySimulatedJobPosting(acme.id, session)).toBe("notFound");
  });

  it("matching : l'offre publiée apparaît quand elle respecte les garde-fous, exclue sinon", async () => {
    for (const [user, minFixedSalary] of [
      [candidate, 55000],
      [picky, 90000],
    ] as const) {
      const experience = await career.createExperience(user.id, {
        roleTitle: "Data engineer",
        startMonth: "2019-01",
        endMonth: undefined,
        seniority: "SENIOR",
        contractType: "CDI",
        sector: "SAAS_SOFTWARE",
        companySize: "S201_500",
        companyStage: "SCALEUP",
        responsibilities: "",
      });
      await career.createAchievement(user.id, {
        title: "Refonte des pipelines de données",
        context: "",
        actions: "Migration des traitements Python et SQL vers Airflow et dbt",
        result: "Temps de calcul divisé par trois",
        skills: ["Python", "SQL", "Airflow", "dbt"],
        experienceId: experience.id,
      });
      await career.saveGuardRails(user.id, {
        minFixedSalary,
        targetTotalPackage: undefined,
        remotePolicy: "HYBRID",
        minRemoteDays: undefined,
        contractTypes: ["CDI"],
        excludedSectors: [],
        excludedCompanies: [],
        maxWeeklyHours: undefined,
        acceptsOnCall: true,
        culturePreferences: [],
        locations: [{ label: "Paris", radiusKm: 30 }],
      });
    }

    const org = await membership(acme);
    const [posting] = await employer.listPostings(org.id);
    const offerId = (await db.jobPosting.findUniqueOrThrow({ where: { id: posting!.id } })).offerId;
    const deps = {
      config: { ...matchingConfig({}), minScore: 0 },
      client: null,
      llmBudget: { remaining: 0 },
    };
    await recomputeUserMatches(db, candidate.id, deps);
    await recomputeUserMatches(db, picky.id, deps);

    const match = await db.match.findUnique({
      where: { userId_offerId: { userId: candidate.id, offerId } },
    });
    expect(match).not.toBeNull();
    expect(
      await db.match.findUnique({ where: { userId_offerId: { userId: picky.id, offerId } } }),
    ).toBeNull();

    // Côté candidat : badge « publiée directement » ; une consultation est comptée (sans identité).
    const view = await getMatch(candidate.id, match!.id);
    expect(view?.offer.direct).toBe(true);
    await markMatchSeen(candidate.id, match!.id);
    await markMatchSeen(candidate.id, match!.id);
    expect((await employer.listPostings(org.id))[0]!.viewCount).toBe(1);
  });

  it("échéance : l'offre se ferme et sort des opportunités ; republication payée", async () => {
    const org = await membership(acme);
    const [posting] = await employer.listPostings(org.id);
    const row = await db.jobPosting.findUniqueOrThrow({ where: { id: posting!.id } });

    expect(await expireDirectPostings(db, { orgId: org.id, now: new Date() })).toBe(0);
    expect(
      await expireDirectPostings(db, {
        orgId: org.id,
        now: new Date(row.expiresAt!.getTime() + 1000),
      }),
    ).toBe(1);
    const expired = await db.jobPosting.findUniqueOrThrow({
      where: { id: posting!.id },
      include: { offer: { select: { status: true, closedAt: true } } },
    });
    expect(expired.status).toBe("CLOSED");
    expect(expired.offer.status).toBe("CLOSED");
    expect(expired.offer.closedAt).toBeInstanceOf(Date);

    await recomputeUserMatches(db, candidate.id, {
      config: { ...matchingConfig({}), minScore: 0 },
      client: null,
      llmBudget: { remaining: 0 },
    });
    expect(await db.match.count({ where: { userId: candidate.id, offerId: row.offerId } })).toBe(0);

    // Republication : nouveau paiement, puis de nouveau en ligne.
    expect((await employer.renewPosting(org.id, posting!.id)).ok).toBe(true);
    const checkout = await employer.startPostingCheckout(acme, org, posting!.id, "fr");
    if (!checkout.ok || checkout.redirect.kind !== "internal") throw new Error("paiement attendu");
    await paySimulatedJobPosting(acme.id, checkout.redirect.href.split("/").at(-1)!);
    const relive = await db.jobPosting.findUniqueOrThrow({
      where: { id: posting!.id },
      include: { offer: { select: { status: true, reopenCount: true } } },
    });
    expect(relive.status).toBe("LIVE");
    expect(relive.offer).toMatchObject({ status: "OPEN", reopenCount: 1 });

    // Fermeture anticipée par l'entreprise.
    expect((await employer.closePosting(org.id, posting!.id)).ok).toBe(true);
    expect((await db.jobOffer.findUniqueOrThrow({ where: { id: row.offerId } })).status).toBe(
      "CLOSED",
    );
  });

  it("modération : offre signalée en revue après paiement, refusée avec motif (e-mail), puis approuvée", async () => {
    const org = await membership(acme);
    const id = await employer.createPosting(
      org,
      postingInput({
        title: "Commercial terrain",
        description: `${postingInput().description} Profil jeune diplômé de moins de 30 ans souhaité.`,
      }),
    );
    const paid = await submitAndPay(acme, id);
    expect(paid.status).toBe("IN_REVIEW");
    expect(paid.offer.status).toBe("DRAFT");
    expect((await db.jobPosting.findUniqueOrThrow({ where: { id } })).flags).toEqual(["age"]);

    const queue = await admin.getModerationQueue();
    const queued = queue.reviewPostings.find((p) => p.id === id);
    expect(queued?.excerpts[0]?.category).toBe("age");

    sent.length = 0;
    expect(await admin.rejectPosting("admin", id, "Critère d'âge interdit", deps)).toMatchObject({
      to: "REJECTED",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(acme.email);
    expect(sent[0]!.subject).toContain("Commercial terrain");
    expect(sent[0]!.text).toContain("Critère d'âge interdit");
    expect(sent[0]!.text).toContain(`https://app.exemple.test/fr/entreprise/offres/${id}`);

    // Corrigée et soumise de nouveau : déjà payée, revue manuelle (refus précédent).
    const org2 = await membership(acme);
    expect(
      (await employer.updatePosting(org2, id, postingInput({ title: "Commercial terrain" }))).ok,
    ).toBe(true);
    expect((await employer.submitPosting(org.id, id)).ok).toBe(true);
    expect((await db.jobPosting.findUniqueOrThrow({ where: { id } })).status).toBe("IN_REVIEW");
    expect(await admin.approvePosting("admin", id, deps)).toMatchObject({ to: "LIVE" });
    expect(sent.at(-1)!.subject).toContain("Commercial terrain");
  });

  it("organisation en attente : offre payée publiée à sa validation ; suspension = offres fermées", async () => {
    const org = await membership(webmail);
    const id = await employer.createPosting(org, postingInput({ title: "Product manager" }));
    const paid = await submitAndPay(webmail, id);
    expect(paid.status).toBe("IN_REVIEW");

    const queue = await admin.getModerationQueue();
    expect(queue.pendingOrgs.find((o) => o.id === org.id)?.ownerEmails).toEqual([webmail.email]);

    sent.length = 0;
    const published = await admin.approveOrganization("admin", org.id, deps);
    expect(published).toEqual([expect.objectContaining({ postingId: id, to: "LIVE" })]);
    expect(sent[0]!.to).toBe(webmail.email);

    const suspended = await admin.suspendOrganization("admin", org.id, "Usurpation", deps);
    expect(suspended).toEqual([expect.objectContaining({ postingId: id, to: "CLOSED" })]);
    const row = await db.jobPosting.findUniqueOrThrow({
      where: { id },
      include: { offer: { select: { status: true } }, organization: true },
    });
    expect(row.offer.status).toBe("CLOSED");
    expect(row.organization).toMatchObject({ status: "SUSPENDED", reviewNote: "Usurpation" });
    expect(sent.at(-1)!.text).toContain("Usurpation");

    // Suspendue : plus de paiement ni de republication.
    const suspendedOrg = await membership(webmail);
    expect(await employer.startPostingCheckout(webmail, suspendedOrg, id, "fr")).toEqual({
      ok: false,
      error: "suspended",
    });
  });

  it("publication gratuite réservée aux administrateurs (ADMIN_EMAILS)", async () => {
    const org = await membership(globex);
    const id = await employer.createPosting(org, postingInput({ title: "Juriste" }));
    await employer.submitPosting(org.id, id);
    expect(await employer.publishFreeAsAdmin(globex, org.id, id)).toEqual({
      ok: false,
      error: "notAllowed",
    });
    process.env.ADMIN_EMAILS = globex.email;
    try {
      const result = await employer.publishFreeAsAdmin(globex, org.id, id);
      expect(result).toMatchObject({ ok: true, outcome: { to: "LIVE" } });
      const payment = await db.jobPostingPayment.findFirstOrThrow({ where: { postingId: id } });
      expect(payment).toMatchObject({ provider: "admin", amountCents: 0, status: "PAID" });
    } finally {
      process.env.ADMIN_EMAILS = "";
    }
  });
});
