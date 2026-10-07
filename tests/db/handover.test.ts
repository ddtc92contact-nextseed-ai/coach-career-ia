import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailMessage } from "@/lib/mail/smtp";

// Base de test, session simulée et SMTP simulé : aucun envoi réel.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", async (original) => ({
  ...(await original<typeof import("next-intl/server")>()),
  getLocale: async () => "fr",
}));

const outbox: MailMessage[] = [];
const sendState: { fail: boolean } = { fail: false };
const fakeSend = vi.fn(async (message: MailMessage) => {
  if (sendState.fail) throw new Error("SMTP indisponible");
  outbox.push(message);
});
const APP_URL = "https://coach.exemple.test";
vi.mock("@/lib/contact/server", () => ({
  contactDeps: () => ({ send: fakeSend, notify: fakeSend, appUrl: APP_URL, ai: null }),
}));

const { db } = await import("@/lib/db");
const { getCurrentUser, requireUser } = await import("@/lib/auth/session");
const { NotFoundError } = await import("@/lib/career/repository");
const { createLogger } = await import("@/lib/logger");
const { encrypt } = await import("@/lib/crypto");
const cards = await import("@/lib/card/repository");
const contacts = await import("@/lib/contact/repository");
const handovers = await import("@/lib/handover/repository");
const { purgeExpiredHandovers } = await import("@/lib/handover/purge");
const actions = await import("@/app/[locale]/app/contacts/actions");
const revealRoute = await import("@/app/api/contacts/[id]/handover/route");
const cvRoute = await import("@/app/api/r/[token]/cv/route");

const url = process.env.TEST_DATABASE_URL;
const run = `h${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const NOW = new Date("2026-10-07T12:00:00Z");
const DAY = 24 * 3_600_000;

const logLines: string[] = [];
const logger = createLogger({ level: "debug", write: (_level, line) => logLines.push(line) });

// Données du coffre (déchiffrées dans le navigateur) que le candidat choisit de révéler.
const SECRET_NAME = { firstName: "Alice", lastName: `Zorglub${run}` };
const SECRET_EMAIL = `alice.zorglub.${run}@perso.example`;
const SECRET_PHONE = "+33 6 98 76 54 32";
const CV_BYTES = new TextEncoder().encode(`%PDF-1.4 CV de ${SECRET_NAME.lastName}`);

type User = { id: string; email: string };

async function newCandidate(label: string): Promise<User> {
  const user = await db.user.create({
    data: { email: `${label}.${run}@exemple.test`, locale: "fr" },
  });
  const experience = await db.experience.create({
    data: {
      userId: user.id,
      roleTitle: "Ingénieure data senior",
      startMonth: new Date("2018-01-01"),
      endMonth: null,
      seniority: "SENIOR",
      contractType: "CDI",
      sector: "SAAS_SOFTWARE",
      companySize: "S201_500",
      companyStage: "SCALEUP",
    },
  });
  await db.achievement.create({
    data: {
      userId: user.id,
      experienceId: experience.id,
      title: "Pipeline de données temps réel",
      result: "Latence divisée par 10",
      evidenceLevel: "DOCUMENT",
    },
  });
  await db.guardRails.create({
    data: {
      userId: user.id,
      minFixedSalary: 55_000,
      remotePolicy: "HYBRID",
      contractTypes: ["CDI"],
      excludedSectors: [],
      excludedCompanies: [],
      culturePreferences: [],
    },
  });
  await cards.regenerateCard(user.id);
  expect(await cards.approveCard(user.id)).toEqual({ ok: true });
  return { id: user.id, email: user.email };
}

let offerCount = 0;
async function newOffer(input: { applyEmail?: string | null; applyUrl?: string | null } = {}) {
  const n = ++offerCount;
  return db.jobOffer.create({
    data: {
      id: `${run}-offer-${n}`,
      source: "test-handover",
      sourceKey: `test-handover:${run}`,
      sourceId: `${run}-${n}`,
      url: `https://emplois.exemple.test/${run}/${n}`,
      urlKey: `emplois.exemple.test/${run}/${n}`,
      title: `Data engineer ${n} (H/F)`,
      companyName: `Initrode ${n}`,
      description:
        "Nous recherchons une personne pour construire nos pipelines de données temps réel. Le poste est en CDI, en mode hybride, et votre équipe sera basée à Paris.",
      country: "FR",
      remotePolicy: "HYBRID",
      contractType: "CDI",
      salaryMin: 60_000,
      salaryMax: 70_000,
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      contentHash: `${run}-${n}`,
      applyEmail:
        input.applyEmail === undefined ? `recrutement${n}@initrode.example` : input.applyEmail,
      applyUrl: input.applyUrl ?? null,
    },
  });
}

/** Contact ENVOYÉ (e-mail) ou transmis (page « Postuler »), avec ou sans réponse. */
async function sentContact(
  user: User,
  options: { channel?: "EMAIL" | "APPLY_URL"; reply?: boolean } = {},
) {
  const offer =
    options.channel === "APPLY_URL"
      ? await newOffer({ applyEmail: null, applyUrl: "https://ats.exemple.test/postuler" })
      : await newOffer();
  const match = await db.match.create({
    data: {
      userId: user.id,
      offerId: offer.id,
      score: 82,
      explanation: {},
      inputHash: "x",
      computedAt: NOW,
    },
  });
  const started = await contacts.startContact(user.id, match.id, { ai: null });
  if (!started.ok) throw new Error(`contact attendu : ${started.error}`);
  expect(
    await contacts.approveDraft(user.id, started.id, { appUrl: APP_URL, now: () => NOW }),
  ).toEqual({ ok: true });
  if (options.channel === "APPLY_URL") {
    expect(await contacts.markSubmitted(user.id, started.id, NOW)).toEqual({ ok: true });
  } else {
    expect(
      await contacts.sendContact(user.id, started.id, {
        send: fakeSend,
        appUrl: APP_URL,
        now: () => NOW,
      }),
    ).toEqual({ ok: true });
  }
  if (options.reply !== false) {
    await db.contactReply.create({
      data: {
        userId: user.id,
        contactId: started.id,
        bodyEnc: encrypt("Bonjour, parlons-en.", { aad: `user:${user.id}:contact-reply` }),
        createdAt: NOW,
      },
    });
  }
  return { id: started.id, offer };
}

const deps = (now = NOW, ttlDays?: number) => ({
  send: fakeSend,
  appUrl: APP_URL,
  now: () => now,
  logger,
  ttlDays,
});

const tokenFrom = (text: string) => /\/r\/([A-Za-z0-9_-]{43})/.exec(text)![1]!;

function revealRequest(contactId: string, payload: unknown, cv?: File, origin = APP_URL) {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  if (cv) form.set("cv", cv);
  return new Request(`${APP_URL}/api/contacts/${contactId}/handover`, {
    method: "POST",
    body: form,
    headers: { origin, host: new URL(APP_URL).host },
  });
}
const routeParams = <T extends object>(params: T) => ({ params: Promise.resolve(params) });

describe.skipIf(!url)("levée d'anonymat : révélation, lien, révocation, expiration", () => {
  let alice: User;
  let bob: User;

  beforeAll(async () => {
    process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    // Plusieurs contacts envoyés par test : le quota quotidien n'est pas l'objet ici.
    process.env.CONTACT_DAILY_LIMIT = "50";
    alice = await newCandidate("alice");
    bob = await newCandidate("bob");
  });

  beforeEach(() => {
    outbox.length = 0;
    logLines.length = 0;
    sendState.fail = false;
    fakeSend.mockClear();
  });

  afterAll(async () => {
    delete process.env.CONTACT_DAILY_LIMIT;
    await db.user.deleteMany({ where: { id: { in: [alice?.id, bob?.id].filter(Boolean) } } });
    await db.jobOffer.deleteMany({ where: { sourceKey: `test-handover:${run}` } });
  });

  it("refusée avant l'envoi, avant une réponse, et sans champ choisi", async () => {
    const noReply = await sentContact(alice, { reply: false });
    const payload = { email: SECRET_EMAIL };
    expect(
      await handovers.revealIdentity(alice.id, noReply.id, { payload, cv: null }, deps()),
    ).toEqual({ ok: false, error: "noReply" });

    const offer = await newOffer();
    const match = await db.match.create({
      data: {
        userId: alice.id,
        offerId: offer.id,
        score: 80,
        explanation: {},
        inputHash: "x",
        computedAt: NOW,
      },
    });
    const draft = await contacts.startContact(alice.id, match.id, { ai: null });
    if (!draft.ok) throw new Error("brouillon attendu");
    expect(
      await handovers.revealIdentity(alice.id, draft.id, { payload, cv: null }, deps()),
    ).toEqual({ ok: false, error: "notSent" });

    const ready = await sentContact(alice);
    outbox.length = 0;
    for (const bad of [{}, { password: "x" }, "texte", { links: [] }]) {
      expect(
        await handovers.revealIdentity(alice.id, ready.id, { payload: bad, cv: null }, deps()),
      ).toEqual({ ok: false, error: "invalid" });
    }
    expect(
      await handovers.revealIdentity(
        alice.id,
        ready.id,
        { payload, cv: { name: "x.html", type: "text/html", bytes: CV_BYTES } },
        deps(),
      ),
    ).toEqual({ ok: false, error: "cvInvalid" });
    expect(await db.handover.count({ where: { userId: alice.id } })).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it("révélation sur le fil A : e-mail sans identité, données chiffrées, lien propre au fil", async () => {
    const a = await sentContact(alice);
    const b = await sentContact(alice);
    const card = await cards.createCardLink(alice.id, { now: NOW });
    if (!card.ok) throw new Error("lien de carte attendu");
    outbox.length = 0;

    const experience = await db.experience.findFirstOrThrow({ where: { userId: alice.id } });
    const result = await handovers.revealIdentity(
      alice.id,
      a.id,
      {
        payload: {
          name: SECRET_NAME,
          email: SECRET_EMAIL,
          employers: [{ experienceId: experience.id, name: `Globex ${run}` }],
        },
        cv: { name: "CV Alice.pdf", type: "application/pdf", bytes: CV_BYTES },
      },
      deps(),
    );
    expect(result).toMatchObject({ ok: true, channel: "EMAIL", url: null });

    // E-mail à l'adresse de candidature de l'offre A, dans sa langue, sans identité.
    expect(outbox).toHaveLength(1);
    const mail = outbox[0]!;
    expect(mail.to).toBe(a.offer.applyEmail);
    expect(mail.text).toContain(`${APP_URL}/fr/r/`);
    expect(mail.text).toContain("agent de carrière IA");
    expect(mail.text).toContain("décision explicite");
    for (const secret of [SECRET_NAME.lastName, SECRET_EMAIL, "Globex"]) {
      expect(`${mail.subject}${mail.text}${mail.html}`).not.toContain(secret);
    }
    const token = tokenFrom(mail.text);

    // Stockage : jeton haché, identité et CV chiffrés ; journal sans identité.
    const row = await db.handover.findFirstOrThrow({ where: { contactId: a.id } });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.payloadEnc).not.toContain(SECRET_NAME.lastName);
    expect(Buffer.from(row.cvEnc!).toString("latin1")).not.toContain(SECRET_NAME.lastName);
    expect(row.fields).toEqual(["name", "email", "employers", "cv"]);
    expect(logLines.join("\n")).not.toMatch(
      new RegExp(`${SECRET_NAME.lastName}|zorglub|Globex`, "i"),
    );
    expect(logLines.join("\n")).toContain("handover.revealed");

    // Fil A : révélé, journalisé ; fil B : rien.
    expect((await contacts.getContact(alice.id, a.id))!.revealedAt).toEqual(NOW);
    const stateA = await handovers.getHandoverState(alice.id, a.id, NOW);
    expect(stateA.active).toMatchObject({
      fields: ["name", "email", "employers", "cv"],
      viewCount: 0,
    });
    expect(stateA.events).toMatchObject([
      { type: "REVEALED", fields: ["name", "email", "employers", "cv"] },
    ]);
    const stateB = await handovers.getHandoverState(alice.id, b.id, NOW);
    expect(stateB).toEqual({ active: null, events: [] });
    expect((await contacts.getContact(alice.id, b.id))!.revealedAt).toBeNull();

    // Profil révélé : identité choisie + carte, CV déchiffré à l'identique.
    const view = await handovers.resolveHandover(token, { now: NOW, countView: true });
    if (view.status !== "active") throw new Error("profil attendu");
    expect(view.profile.identity).toEqual({
      name: SECRET_NAME,
      email: SECRET_EMAIL,
      employers: [{ name: `Globex ${run}`, role: "Ingénieure data senior" }],
      cv: { name: "CV Alice.pdf", type: "application/pdf", size: CV_BYTES.length },
    });
    expect(view.profile.identity).not.toHaveProperty("phone");
    expect(view.profile.card?.headline).toBe("Ingénieure data senior");
    expect(view.profile.offerTitle).toBe(a.offer.title);
    const cv = await handovers.handoverCv(token, NOW);
    expect(
      cv.status === "active" && Buffer.from(cv.file!.bytes).equals(Buffer.from(CV_BYTES)),
    ).toBe(true);
    const download = await cvRoute.GET(
      new Request(`${APP_URL}/api/r/${token}/cv`),
      routeParams({ token }),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("x-robots-tag")).toContain("noindex");

    // Les liens de carte anonyme (fil B, lien manuel) n'exposent rien de l'identité.
    const sentB = await contacts.getContact(alice.id, b.id);
    const cardTokenB = /\/p\/([A-Za-z0-9_-]{43})/.exec(sentB!.sentText!)![1]!;
    for (const cardToken of [cardTokenB, card.link.token]) {
      const resolved = await cards.resolveCardLink(cardToken, { now: NOW });
      expect(resolved).not.toBeNull();
      expect(JSON.stringify(resolved)).not.toMatch(
        new RegExp(`${SECRET_NAME.lastName}|${SECRET_EMAIL}|Globex`),
      );
      // Le jeton de carte n'ouvre pas de profil révélé, et inversement.
      expect(await handovers.resolveHandover(cardToken, { now: NOW })).toEqual({
        status: "unknown",
      });
    }
    expect(await cards.resolveCardLink(token, { now: NOW })).toBeNull();

    // Une seule levée active par fil.
    expect(
      await handovers.revealIdentity(
        alice.id,
        a.id,
        { payload: { phone: SECRET_PHONE }, cv: null },
        deps(),
      ),
    ).toEqual({ ok: false, error: "alreadyRevealed" });
  });

  it("un autre candidat ne peut ni révéler, ni révoquer, ni voir l'état du fil (404)", async () => {
    const a = await sentContact(alice);
    const payload = { email: "bob@exemple.test" };
    await expect(
      handovers.revealIdentity(bob.id, a.id, { payload, cv: null }, deps()),
    ).rejects.toThrow(NotFoundError);
    await expect(handovers.revokeHandover(bob.id, a.id)).rejects.toThrow(NotFoundError);
    await expect(
      handovers.revealIdentity(bob.id, { not: "x" }, { payload, cv: null }, deps()),
    ).rejects.toThrow(NotFoundError);
    expect(await handovers.getHandoverState(bob.id, a.id, NOW)).toEqual({
      active: null,
      events: [],
    });

    // Par la route et l'action, avec la session de Bob.
    vi.mocked(getCurrentUser).mockResolvedValue(bob);
    vi.mocked(requireUser).mockResolvedValue(bob);
    const response = await revealRoute.POST(
      revealRequest(a.id, payload),
      routeParams({ id: a.id }),
    );
    expect(response.status).toBe(404);
    await expect(actions.revokeHandoverAction(a.id)).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    );
    expect(await db.handover.count({ where: { contactId: a.id } })).toBe(0);
  });

  it("route : session requise, même origine, champs choisis seulement ; puis révocation (404/410)", async () => {
    const a = await sentContact(alice);
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(
      (await revealRoute.POST(revealRequest(a.id, {}), routeParams({ id: a.id }))).status,
    ).toBe(401);

    vi.mocked(getCurrentUser).mockResolvedValue(alice);
    vi.mocked(requireUser).mockResolvedValue(alice);
    const crossSite = revealRequest(
      a.id,
      { phone: SECRET_PHONE },
      undefined,
      "https://malveillant.test",
    );
    expect((await revealRoute.POST(crossSite, routeParams({ id: a.id }))).status).toBe(403);

    const cv = new File([CV_BYTES], "cv.pdf", { type: "application/pdf" });
    const response = await revealRoute.POST(
      revealRequest(a.id, { phone: SECRET_PHONE }, cv),
      routeParams({ id: a.id }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, url: null });
    const token = tokenFrom(outbox.at(-1)!.text);
    const view = await handovers.resolveHandover(token, { now: NOW });
    expect(view.status === "active" && view.profile.identity).toEqual({
      phone: SECRET_PHONE,
      cv: { name: "cv.pdf", type: "application/pdf", size: CV_BYTES.length },
    });

    // Révocation : lien mort, données effacées, entrée au journal.
    await actions.revokeHandoverAction(a.id);
    expect(await handovers.resolveHandover(token, { now: NOW })).toEqual({ status: "gone" });
    expect(await handovers.handoverCv(token, NOW)).toEqual({ status: "gone" });
    const gone = await cvRoute.GET(
      new Request(`${APP_URL}/api/r/${token}/cv`),
      routeParams({ token }),
    );
    expect(gone.status).toBe(410);
    const unknown = "z".repeat(43);
    expect((await cvRoute.GET(new Request(APP_URL), routeParams({ token: unknown }))).status).toBe(
      404,
    );
    const row = await db.handover.findFirstOrThrow({ where: { contactId: a.id } });
    expect(row).toMatchObject({ payloadEnc: null, cvEnc: null });
    expect(row.revokedAt).not.toBeNull();
    expect(row.purgedAt).not.toBeNull();
    const state = await handovers.getHandoverState(alice.id, a.id);
    expect(state.active).toBeNull();
    expect(state.events.map((e) => e.type)).toEqual(["REVOKED", "REVEALED"]);
    // Révoquer à nouveau : sans effet.
    expect(await handovers.revokeHandover(alice.id, a.id)).toBe(false);
    // Le fil reste « révélé » (l'entreprise a pu voir l'identité) ; nouvelle levée possible.
    expect((await contacts.getContact(alice.id, a.id))!.revealedAt).not.toBeNull();
    expect(
      await handovers.revealIdentity(
        alice.id,
        a.id,
        { payload: { email: SECRET_EMAIL }, cv: null },
        deps(),
      ),
    ).toMatchObject({ ok: true });
  });

  it("expiration : lien 404/410 et données purgées (à la lecture et par le worker)", async () => {
    const a = await sentContact(alice);
    const b = await sentContact(alice);
    expect(
      await handovers.revealIdentity(
        alice.id,
        a.id,
        { payload: { email: SECRET_EMAIL }, cv: null },
        deps(NOW, 1),
      ),
    ).toMatchObject({ ok: true });
    const tokenA = tokenFrom(outbox.at(-1)!.text);
    expect(
      await handovers.revealIdentity(
        alice.id,
        b.id,
        {
          payload: { phone: SECRET_PHONE },
          cv: { name: "cv.pdf", type: "application/pdf", bytes: CV_BYTES },
        },
        deps(NOW, 1),
      ),
    ).toMatchObject({ ok: true });
    const tokenB = tokenFrom(outbox.at(-1)!.text);
    const later = new Date(NOW.getTime() + 2 * DAY);

    // A : purgé à la lecture.
    expect(await handovers.resolveHandover(tokenA, { now: later })).toEqual({ status: "gone" });
    expect(await db.handover.findFirstOrThrow({ where: { contactId: a.id } })).toMatchObject({
      payloadEnc: null,
      cvEnc: null,
    });

    // B : purgé par le worker.
    const purged = await purgeExpiredHandovers(db, { now: later, logger });
    expect(purged).toBeGreaterThanOrEqual(1);
    const rowB = await db.handover.findFirstOrThrow({ where: { contactId: b.id } });
    expect(rowB).toMatchObject({ payloadEnc: null, cvEnc: null, revokedAt: null });
    expect(rowB.purgedAt).toEqual(later);
    expect(await handovers.handoverCv(tokenB, later)).toEqual({ status: "gone" });
    expect(
      (await handovers.getHandoverState(alice.id, b.id, later)).events.map((e) => e.type),
    ).toEqual(["EXPIRED", "REVEALED"]);
    // Passage suivant : rien à purger pour ces fils.
    await purgeExpiredHandovers(db, { now: later });
    expect(await db.handoverEvent.count({ where: { contactId: b.id, type: "EXPIRED" } })).toBe(1);
  });

  it("échec d'envoi : rien n'est révélé ; offre sans adresse : lien à transmettre soi-même", async () => {
    const a = await sentContact(alice);
    sendState.fail = true;
    expect(
      await handovers.revealIdentity(
        alice.id,
        a.id,
        { payload: { email: SECRET_EMAIL }, cv: null },
        deps(),
      ),
    ).toEqual({ ok: false, error: "sendFailed" });
    expect(await db.handover.count({ where: { contactId: a.id } })).toBe(0);
    expect(await db.handoverEvent.count({ where: { contactId: a.id } })).toBe(0);
    expect((await contacts.getContact(alice.id, a.id))!.revealedAt).toBeNull();
    sendState.fail = false;

    const manual = await sentContact(alice, { channel: "APPLY_URL" });
    outbox.length = 0;
    const result = await handovers.revealIdentity(
      alice.id,
      manual.id,
      { payload: { email: SECRET_EMAIL }, cv: null },
      deps(),
    );
    if (!result.ok || !result.url) throw new Error("lien attendu");
    expect(result.url).toMatch(new RegExp(`^${APP_URL}/fr/r/[A-Za-z0-9_-]{43}$`));
    expect(outbox).toHaveLength(0);
    const view = await handovers.resolveHandover(tokenFrom(result.url), { now: NOW });
    expect(view.status).toBe("active");
  });
});
