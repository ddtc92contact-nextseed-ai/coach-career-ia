import { randomBytes, randomUUID } from "node:crypto";
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

const outbox: MailMessage[] = [];
const fakeSend = vi.fn(async (message: MailMessage) => {
  outbox.push(message);
});
const APP_URL = "https://coach.exemple.test";
vi.mock("@/lib/contact/server", () => ({
  contactDeps: () => ({ send: fakeSend, notify: fakeSend, appUrl: APP_URL, ai: null }),
}));

const { db } = await import("@/lib/db");
const { getCurrentUser, requireUser } = await import("@/lib/auth/session");
const { createLogger } = await import("@/lib/logger");
const cards = await import("@/lib/card/repository");
const contacts = await import("@/lib/contact/repository");
const handovers = await import("@/lib/handover/repository");
const inbox = await import("@/lib/employer/inbox");
const negotiation = await import("@/lib/negotiation/repository");
const { entitlementsFor } = await import("@/lib/billing/entitlements");
const inboxActions = await import("@/app/[locale]/entreprise/(espace)/messages/actions");
const { default: ThreadPage } =
  await import("@/app/[locale]/entreprise/(espace)/messages/[id]/page");
const { default: InboxPage } = await import("@/app/[locale]/entreprise/(espace)/messages/page");
const cvRoute = await import("@/app/api/entreprise/messages/[id]/cv/route");

const url = process.env.TEST_DATABASE_URL;
const run = `pi${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const NOW = new Date("2026-10-07T12:00:00Z");
const DAY = 24 * 3_600_000;
const REVOKED_AT = new Date(NOW.getTime() + 60_000);
const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/;

const logLines: string[] = [];
const logger = createLogger({ level: "debug", write: (_level, line) => logLines.push(line) });

// Données du coffre (déchiffrées dans le navigateur) que la candidate choisit de révéler.
const SECRET_NAME = { firstName: "Alice", lastName: `Zorglub${run}` };
const SECRET_EMAIL = `alice.zorglub.${run}@perso.example`;
const CV_BYTES = new TextEncoder().encode(`%PDF-1.4 CV de ${SECRET_NAME.lastName}`);
// Contenu de la mémoire, donc de la carte : ne doit figurer dans aucune notification.
const ACHIEVEMENT = `Pipeline temps réel ${run}`;

type User = { id: string; email: string };

async function newUser(label: string, locale = "fr"): Promise<User> {
  return db.user.create({
    data: { email: `${label}.${run}@exemple.test`, locale },
    select: { id: true, email: true },
  });
}

async function newCandidate(label: string): Promise<User> {
  const user = await newUser(label);
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
      title: ACHIEVEMENT,
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
  return user;
}

/** Organisation active et ses membres. */
async function newOrg(label: string, members: User[]) {
  const company = await db.company.create({
    data: { slug: `direct-${randomUUID()}`, name: `${label} ${run}`, website: "https://x.test" },
  });
  return db.organization.create({
    data: {
      name: `${label} ${run}`,
      website: `https://${label}-${run}.test`,
      domain: `${label}-${run}.test`,
      sector: "SAAS_SOFTWARE",
      size: "S51_200",
      country: "FR",
      status: "ACTIVE",
      verifiedAt: NOW,
      companyId: company.id,
      members: {
        create: members.map((m, i) => ({ userId: m.id, role: i === 0 ? "OWNER" : "MEMBER" })),
      },
    },
    select: { id: true, companyId: true, name: true },
  });
}

let offerCount = 0;
const offerBase = (n: number) => ({
  url: `https://emplois.exemple.test/${run}/${n}`,
  urlKey: `emplois.exemple.test/${run}/${n}`,
  title: `Data engineer ${n} (H/F)`,
  description:
    "Nous recherchons une personne pour construire nos pipelines de données temps réel. Le poste est en CDI, en mode hybride, et votre équipe sera basée à Paris.",
  country: "FR",
  remotePolicy: "HYBRID" as const,
  contractType: "CDI" as const,
  salaryMin: 60_000,
  salaryMax: 70_000,
  salaryCurrency: "EUR",
  salaryPeriod: "YEAR" as const,
  firstSeenAt: NOW,
  lastSeenAt: NOW,
  contentHash: `${run}-${n}`,
});

/** Offre publiée directement par l'organisation, en ligne. */
async function directOffer(org: { id: string; companyId: string; name: string }) {
  const n = ++offerCount;
  const offer = await db.jobOffer.create({
    data: {
      ...offerBase(n),
      id: `${run}-direct-${n}`,
      source: "direct",
      sourceKey: `direct:${org.id}`,
      sourceId: `${run}-${n}`,
      companyId: org.companyId,
      companyName: org.name,
      status: "OPEN",
    },
  });
  await db.jobPosting.create({
    data: {
      orgId: org.id,
      offerId: offer.id,
      status: "LIVE",
      paidAt: NOW,
      approvedAt: NOW,
      publishedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * DAY),
    },
  });
  return offer;
}

/** Offre collectée par le radar, avec une adresse de candidature. */
async function emailOffer() {
  const n = ++offerCount;
  return db.jobOffer.create({
    data: {
      ...offerBase(n),
      id: `${run}-email-${n}`,
      source: "test-portal",
      sourceKey: `test-portal:${run}`,
      sourceId: `${run}-${n}`,
      companyName: `Initrode ${n}`,
      applyEmail: `recrutement${n}@initrode.example`,
    },
  });
}

async function draftFor(user: User, offerId: string) {
  const match = await db.match.create({
    data: { userId: user.id, offerId, score: 82, explanation: {}, inputHash: "x", computedAt: NOW },
  });
  const started = await contacts.startContact(user.id, match.id, { ai: null });
  if (!started.ok) throw new Error(`brouillon attendu : ${started.error}`);
  expect(
    await contacts.approveDraft(user.id, started.id, { appUrl: APP_URL, now: () => NOW }),
  ).toEqual({ ok: true });
  return { id: started.id, matchId: match.id };
}

const sendDeps = (now = NOW) => ({
  send: fakeSend,
  notify: fakeSend,
  appUrl: APP_URL,
  now: () => now,
  logger,
});
const replyDeps = (now = NOW) => ({ send: fakeSend, appUrl: APP_URL, now: () => now, logger });

async function portalContact(user: User, org: { id: string; companyId: string; name: string }) {
  const offer = await directOffer(org);
  const draft = await draftFor(user, offer.id);
  expect(await contacts.sendContact(user.id, draft.id, sendDeps())).toEqual({ ok: true });
  return { id: draft.id, offer };
}

function signIn(user: User | null) {
  vi.mocked(requireUser).mockImplementation(async () => {
    if (!user) throw new Error("NEXT_REDIRECT");
    return user as never;
  });
  vi.mocked(getCurrentUser).mockResolvedValue(user as never);
}

const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });
const cvRequest = (id: string) => new Request(`${APP_URL}/api/entreprise/messages/${id}/cv`);

describe.skipIf(!url)(
  "espace entreprise v2 : messagerie des offres directes (canal PORTAL)",
  () => {
    let alice: User;
    let bob: User;
    let ownerA: User;
    let memberA: User; // membre anglophone de l'organisation A
    let ownerB: User;
    let outsider: User; // compte uniquement candidat
    let orgA: { id: string; companyId: string; name: string };
    let orgB: { id: string; companyId: string; name: string };

    beforeAll(async () => {
      process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
      process.env.CONTACT_DAILY_LIMIT = "50";
      alice = await newCandidate("alice");
      bob = await newCandidate("bob");
      ownerA = await newUser("rh-a");
      memberA = await newUser("hr-a", "en");
      ownerB = await newUser("rh-b");
      outsider = await newUser("outsider");
      orgA = await newOrg("acme", [ownerA, memberA]);
      orgB = await newOrg("globex", [ownerB]);
    });

    beforeEach(() => {
      outbox.length = 0;
      logLines.length = 0;
      fakeSend.mockClear();
    });

    afterAll(async () => {
      delete process.env.CONTACT_DAILY_LIMIT;
      const users = [alice, bob, ownerA, memberA, ownerB, outsider]
        .filter(Boolean)
        .map((u) => u.id);
      const orgs = [orgA, orgB].filter(Boolean);
      await db.jobOffer.deleteMany({ where: { id: { startsWith: run } } });
      await db.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
      await db.company.deleteMany({ where: { id: { in: orgs.map((o) => o.companyId) } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    });

    it("routage : PORTAL pour une offre directe (organisation destinataire), EMAIL sinon", async () => {
      const direct = await directOffer(orgA);
      const viaPortal = await draftFor(alice, direct.id);
      const mail = await emailOffer();
      const viaEmail = await draftFor(alice, mail.id);

      const portalRow = await db.contact.findUniqueOrThrow({ where: { id: viaPortal.id } });
      expect(portalRow).toMatchObject({ channel: "PORTAL", orgId: orgA.id, status: "APPROVED" });
      const emailRow = await db.contact.findUniqueOrThrow({ where: { id: viaEmail.id } });
      expect(emailRow).toMatchObject({ channel: "EMAIL", orgId: null });
      // Brouillon adapté au canal : pas de « lien pour répondre » dans la messagerie.
      expect(contacts.decryptSentMessage(portalRow).body).toContain("répondre directement ici");
      expect(contacts.decryptSentMessage(emailRow).body).toContain("un lien pour répondre");
      expect((await contacts.contactOptions(alice.id, viaPortal.matchId))!.channel).toBe("PORTAL");
      // Approuvé mais pas envoyé : rien n'apparaît dans la messagerie.
      expect(await inbox.listThreads(orgA.id)).toEqual([]);
      expect(await inbox.getThread(orgA.id, viaPortal.id)).toBeNull();
    });

    it("envoi : remis dans la messagerie de A, membres prévenus sans aucune donnée candidat", async () => {
      const { id, offer } = await portalContact(alice, orgA);
      const row = await db.contact.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: "SENT", channel: "PORTAL", orgId: orgA.id });
      expect(row.cardLinkId).not.toBeNull();

      // Une notification par membre, dans sa langue ; rien à une adresse de candidature.
      expect(outbox.map((m) => m.to).sort()).toEqual([ownerA.email, memberA.email].sort());
      const fr = outbox.find((m) => m.to === ownerA.email)!;
      const en = outbox.find((m) => m.to === memberA.email)!;
      expect(fr.subject).toBe(`Vous avez reçu une candidature anonyme pour ${offer.title}`);
      expect(en.subject).toBe(`You have received an anonymous application for ${offer.title}`);
      expect(fr.text).toContain(`${APP_URL}/fr/entreprise/messages/${id}`);
      const { subject, body } = contacts.decryptSentMessage(row);
      for (const m of outbox) {
        const all = `${m.subject}${m.text}${m.html}`;
        for (const secret of [body.slice(0, 40), subject, ACHIEVEMENT, alice.email, alice.id]) {
          expect(all).not.toContain(secret);
        }
        expect(all).not.toMatch(/\/p\/[A-Za-z0-9_-]{43}/);
      }
      expect(logLines.join("\n")).toContain('"channel":"PORTAL"');
      expect(logLines.join("\n")).not.toContain(ACHIEVEMENT);

      // Fil de A : nouveau, carte et message de l'agent ; B n'en voit rien.
      const listed = await inbox.listThreads(orgA.id);
      expect(listed.find((t) => t.id === id)).toMatchObject({
        offerTitle: offer.title,
        status: "NEW",
      });
      expect(JSON.stringify(listed)).not.toContain(alice.id);
      expect(await inbox.listThreads(orgB.id)).toEqual([]);
      expect(await inbox.countNewThreads(orgA.id)).toBeGreaterThan(0);

      const thread = (await inbox.getThread(orgA.id, id, { now: NOW, open: true }))!;
      expect(thread.status).toBe("READ");
      expect(thread.message.subject).toBe(subject);
      expect(thread.message.body).toBe(body);
      expect(thread.card?.headline).toBeTruthy();
      expect(thread.revealed).toBeNull();
      expect(JSON.stringify(thread)).not.toContain(alice.id);
      expect(await db.cardLink.findUniqueOrThrow({ where: { id: row.cardLinkId! } })).toMatchObject(
        {
          viewCount: 1,
        },
      );
    });

    it("IDOR : l'organisation B, un non-membre ou un contact e-mail → introuvable (404)", async () => {
      const { id } = await portalContact(alice, orgA);
      const mail = await emailOffer();
      const viaEmail = await draftFor(alice, mail.id);
      await contacts.sendContact(alice.id, viaEmail.id, sendDeps());

      expect(await inbox.getThread(orgB.id, id)).toBeNull();
      expect(await inbox.getThread(orgA.id, viaEmail.id)).toBeNull();
      expect(await inbox.getThread(orgA.id, { not: "x" })).toBeNull();
      const member = { userId: ownerB.id, orgId: orgB.id };
      expect(await inbox.replyInThread(member, id, { body: "Bonjour" }, replyDeps())).toEqual({
        ok: false,
        error: "notFound",
      });
      expect(await inbox.closeThread(member, id, replyDeps())).toEqual({
        ok: false,
        error: "notFound",
      });
      expect(await inbox.threadCv(orgB.id, id)).toBeNull();
      expect(await db.contactReply.count({ where: { contactId: id } })).toBe(0);

      for (const user of [ownerB, outsider, alice]) {
        signIn(user);
        await expect(ThreadPage(params({ id }))).rejects.toThrow(NOT_FOUND);
        await expect(inboxActions.closeThreadAction(id)).rejects.toThrow(NOT_FOUND);
        expect((await cvRoute.GET(cvRequest(id), params({ id }))).status).toBe(404);
      }
      signIn(outsider);
      await expect(InboxPage()).rejects.toThrow(NOT_FOUND);
      signIn(null);
      expect((await cvRoute.GET(cvRequest(id), params({ id }))).status).toBe(404);
      expect((await db.contact.findUniqueOrThrow({ where: { id } })).orgClosedAt).toBeNull();
    });

    it("parcours : réponse dans le fil → candidate prévenue et lit la réponse ; levée puis révocation", async () => {
      const { id } = await portalContact(alice, orgA);
      outbox.length = 0;

      // Réponse d'un membre de A : une ContactReply, lue telle quelle par /app/contacts.
      signIn(ownerA);
      const form = new FormData();
      form.set("body", "Bonjour, votre profil nous intéresse. Échangeons ?");
      expect(await inboxActions.replyThreadAction(id, {}, form)).toEqual({ ok: true });
      const reply = await db.contactReply.findFirstOrThrow({ where: { contactId: id } });
      expect(reply).toMatchObject({ userId: alice.id, authorId: ownerA.id, closing: false });
      expect(reply.bodyEnc).not.toContain("profil");
      expect(outbox).toHaveLength(1);
      expect(outbox[0]!.to).toBe(alice.email);
      expect(outbox[0]!.text).not.toContain("profil nous intéresse");
      const seen = (await contacts.getContact(alice.id, id))!;
      expect(seen.replies.map((r) => r.body)).toEqual([
        "Bonjour, votre profil nous intéresse. Échangeons ?",
      ]);
      expect((await inbox.getThread(orgA.id, id))!.status).toBe("REPLIED");

      // La candidate révèle nom + e-mail (+ CV) : visibles dans le fil de A seulement.
      outbox.length = 0;
      const revealed = await handovers.revealIdentity(
        alice.id,
        id,
        {
          payload: { name: SECRET_NAME, email: SECRET_EMAIL },
          cv: { name: "CV Alice.pdf", type: "application/pdf", bytes: CV_BYTES },
        },
        { send: null, appUrl: null, now: () => NOW, logger },
      );
      expect(revealed).toMatchObject({ ok: true, channel: "PORTAL", url: null });
      expect(outbox).toHaveLength(0);
      const thread = (await inbox.getThread(orgA.id, id, { now: NOW, open: true }))!;
      expect(thread.revealed?.identity).toMatchObject({ name: SECRET_NAME, email: SECRET_EMAIL });
      expect(await inbox.getThread(orgB.id, id)).toBeNull();
      const file = await inbox.threadCv(orgA.id, id);
      expect(Buffer.from(file!.bytes).toString()).toContain(SECRET_NAME.lastName);
      signIn(ownerA);
      const cv = await cvRoute.GET(cvRequest(id), params({ id }));
      expect(cv.status).toBe(200);
      expect(cv.headers.get("cache-control")).toContain("no-store");
      const handover = await db.handover.findFirstOrThrow({ where: { contactId: id } });
      expect(handover.viewCount).toBe(1);
      expect(logLines.join("\n")).not.toMatch(new RegExp(`${SECRET_NAME.lastName}|zorglub`, "i"));

      // Révocation : disparu du fil immédiatement, CV compris ; journal à jour.
      expect(await handovers.revokeHandover(alice.id, id, { now: REVOKED_AT, logger })).toBe(true);
      expect((await inbox.getThread(orgA.id, id, { now: REVOKED_AT }))!.revealed).toBeNull();
      expect(await inbox.threadCv(orgA.id, id)).toBeNull();
      expect((await cvRoute.GET(cvRequest(id), params({ id }))).status).toBe(404);
      const events = await handovers.getHandoverState(alice.id, id, REVOKED_AT);
      expect(events.events.map((e) => e.type)).toEqual(["REVOKED", "REVEALED"]);
    });

    it("carte retirée ou expirée, levée expirée : plus rien d'affiché dans le fil", async () => {
      const { id } = await portalContact(bob, orgA);
      await inbox.replyInThread(
        { userId: ownerA.id, orgId: orgA.id },
        id,
        { body: "Bonjour !" },
        replyDeps(),
      );
      const row = await db.contact.findUniqueOrThrow({ where: { id } });
      expect((await inbox.getThread(orgA.id, id, { now: NOW }))!.card).not.toBeNull();

      // Lien de la carte expiré (même règle que /p/<jeton>).
      const later = new Date(NOW.getTime() + 31 * DAY);
      expect((await inbox.getThread(orgA.id, id, { now: later }))!.card).toBeNull();
      // Carte modifiée depuis sa validation : plus partageable.
      await cards.regenerateCard(bob.id);
      expect((await inbox.getThread(orgA.id, id, { now: NOW }))!.card).toBeNull();
      expect(await cards.approveCard(bob.id)).toEqual({ ok: true });
      // Lien révoqué par le candidat.
      await cards.revokeCardLink(bob.id, row.cardLinkId!, NOW);
      expect((await inbox.getThread(orgA.id, id, { now: NOW }))!.card).toBeNull();

      // Levée expirée : purgée à la lecture, journal « expiré ».
      expect(
        await handovers.revealIdentity(
          bob.id,
          id,
          { payload: { email: SECRET_EMAIL }, cv: null },
          { send: null, appUrl: null, now: () => NOW, ttlDays: 1 },
        ),
      ).toMatchObject({ ok: true });
      expect((await inbox.getThread(orgA.id, id, { now: NOW }))!.revealed).not.toBeNull();
      const expired = new Date(NOW.getTime() + 2 * DAY);
      expect((await inbox.getThread(orgA.id, id, { now: expired }))!.revealed).toBeNull();
      const stored = await db.handover.findFirstOrThrow({ where: { contactId: id } });
      expect(stored).toMatchObject({ payloadEnc: null, purgedAt: expired });
      expect((await handovers.getHandoverState(bob.id, id, expired)).events[0]!.type).toBe(
        "EXPIRED",
      );
    });

    it("clôture polie : message type localisé, fil clos, plus de réponse ni de levée", async () => {
      const { id, offer } = await portalContact(alice, orgA);
      const member = { userId: memberA.id, orgId: orgA.id };
      await inbox.replyInThread(
        member,
        id,
        { body: "Merci, nous revenons vers vous." },
        replyDeps(),
      );
      outbox.length = 0;

      expect(await inbox.closeThread(member, id, replyDeps())).toEqual({ ok: true });
      expect(await inbox.closeThread(member, id, replyDeps())).toEqual({
        ok: false,
        error: "closed",
      });
      const thread = (await inbox.getThread(orgA.id, id))!;
      expect(thread.status).toBe("CLOSED");
      const closing = thread.replies.at(-1)!;
      expect(closing.closing).toBe(true);
      // Langue de l'échange (celle de l'offre, ici le français).
      expect(closing.body).toBe(inbox.closingMessage("fr", offer.title));
      expect(closing.body).toContain(offer.title);
      expect(inbox.closingMessage("en", offer.title)).toContain("Thank you");
      expect(outbox.map((m) => m.to)).toEqual([alice.email]);

      expect(await inbox.replyInThread(member, id, { body: "Encore un mot" }, replyDeps())).toEqual(
        { ok: false, error: "closed" },
      );
      const seen = (await contacts.getContact(alice.id, id))!;
      expect(seen.closedAt).not.toBeNull();
      expect(seen.replies.at(-1)).toMatchObject({ closing: true });
      expect(
        await handovers.revealIdentity(
          alice.id,
          id,
          { payload: { email: SECRET_EMAIL }, cv: null },
          { send: null, appUrl: null, now: () => NOW },
        ),
      ).toEqual({ ok: false, error: "closed" });
    });

    it("réponse invalide refusée ; limite quotidienne de réponses par fil", async () => {
      const { id } = await portalContact(bob, orgA);
      const member = { userId: ownerA.id, orgId: orgA.id };
      expect(await inbox.replyInThread(member, id, { body: "x" }, replyDeps())).toEqual({
        ok: false,
        error: "invalid",
      });
      for (let i = 0; i < 10; i++) {
        expect(
          await inbox.replyInThread(member, id, { body: `Message ${i}` }, replyDeps()),
        ).toEqual({ ok: true });
      }
      expect(await inbox.replyInThread(member, id, { body: "Un de trop" }, replyDeps())).toEqual({
        ok: false,
        error: "rateLimited",
      });
      // La clôture reste possible.
      expect(await inbox.closeThread(member, id, replyDeps())).toEqual({ ok: true });
    });

    it("quota quotidien partagé entre les envois e-mail et la messagerie", async () => {
      const carol = await newCandidate("carol");
      try {
        process.env.CONTACT_DAILY_LIMIT = "1";
        const mail = await emailOffer();
        const viaEmail = await draftFor(carol, mail.id);
        expect(await contacts.sendContact(carol.id, viaEmail.id, sendDeps())).toEqual({ ok: true });

        const direct = await directOffer(orgB);
        const viaPortal = await draftFor(carol, direct.id);
        expect(await contacts.sendContact(carol.id, viaPortal.id, sendDeps())).toEqual({
          ok: false,
          error: "quota",
        });
        expect(await db.contact.findUniqueOrThrow({ where: { id: viaPortal.id } })).toMatchObject({
          status: "APPROVED",
          sentAt: null,
        });
        expect(await inbox.listThreads(orgB.id)).toEqual([]);
        expect(await contacts.getQuota(carol.id, NOW)).toMatchObject({ sent: 1, remaining: 0 });

        // Le lendemain, l'envoi dans la messagerie passe et compte à son tour.
        const tomorrow = new Date(NOW.getTime() + DAY + 1000);
        expect(await contacts.sendContact(carol.id, viaPortal.id, sendDeps(tomorrow))).toEqual({
          ok: true,
        });
        expect(await contacts.getQuota(carol.id, tomorrow)).toMatchObject({
          sent: 1,
          remaining: 0,
        });
        expect((await inbox.listThreads(orgB.id)).map((t) => t.id)).toEqual([viaPortal.id]);
      } finally {
        process.env.CONTACT_DAILY_LIMIT = "50";
        await db.user.delete({ where: { id: carol.id } });
      }
    });

    it("négociation (#37) sur un fil PORTAL : réponses lues comme entrantes, contre-propositions remises dans le fil", async () => {
      const { id } = await portalContact(alice, orgA);
      const member = { userId: ownerA.id, orgId: orgA.id };
      await inbox.replyInThread(
        member,
        id,
        { body: "Nous proposons 58 000 € brut annuel en CDI." },
        replyDeps(),
      );
      expect(
        await negotiation.saveMandate(alice.id, id, {
          salaryFloor: 55_000,
          salaryTarget: 62_000,
          remoteDaysMin: 2,
          location: null,
          contractType: "CDI",
          startDate: null,
          title: null,
          otherPoints: [],
          niceToHave: [],
          facts: null,
        }),
      ).toEqual({ ok: true });

      // Réponse du portail pendant la négociation : message entrant du fil de négociation.
      await inbox.replyInThread(
        member,
        id,
        { body: "Nous pouvons monter à 60 000 €." },
        replyDeps(new Date(NOW.getTime() + 1000)),
      );
      let view = await negotiation.getNegotiation(alice.id, id);
      expect(view.messages.filter((m) => m.direction === "IN").map((m) => m.body)).toEqual([
        "Nous pouvons monter à 60 000 €.",
      ]);
      expect(view.analysis).not.toBeNull();

      // Contre-proposition approuvée → remise dans la messagerie, sans e-mail à une adresse de candidature.
      const premium = entitlementsFor({ email: alice.email, plan: "PREMIUM" }, {});
      const drafted = await negotiation.generateDraft(alice.id, id, "counter", {
        ai: null,
        entitlements: premium,
      });
      expect(drafted).toMatchObject({ ok: true });
      view = await negotiation.getNegotiation(alice.id, id);
      const pending = view.pending!;
      expect(
        await negotiation.approveMessage(alice.id, id, pending.id, { appUrl: APP_URL }),
      ).toEqual({ ok: true });
      outbox.length = 0;
      const later = new Date(NOW.getTime() + 2000);
      expect(
        await negotiation.sendMessage(alice.id, id, pending.id, {
          send: fakeSend,
          notify: fakeSend,
          appUrl: APP_URL,
          now: () => later,
          logger,
        }),
      ).toEqual({ ok: true });
      expect(outbox.map((m) => m.to).sort()).toEqual([ownerA.email, memberA.email].sort());
      for (const m of outbox) expect(`${m.text}${m.html}`).not.toContain(pending.body.slice(0, 30));

      const thread = (await inbox.getThread(orgA.id, id))!;
      expect(thread.replies.map((r) => r.from)).toEqual(["company", "company", "candidate"]);
      expect(thread.replies.at(-1)!.body).toBe(pending.body);
      // Quota commun : la contre-proposition compte comme un envoi.
      expect((await contacts.getQuota(alice.id, later)).sent).toBeGreaterThanOrEqual(2);
    });
  },
);
