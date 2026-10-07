import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailMessage } from "@/lib/mail/smtp";

// Base de test, session simulée, IA simulée et SMTP simulé : aucun envoi réel.
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
const notifications: MailMessage[] = [];
const fakeSend = vi.fn(async (message: MailMessage) => void outbox.push(message));
const fakeNotify = vi.fn(async (message: MailMessage) => void notifications.push(message));
const APP_URL = "https://coach.exemple.test";
const aiState: { client: unknown } = { client: null };
vi.mock("@/lib/contact/server", () => ({
  contactDeps: () => ({ send: fakeSend, notify: fakeNotify, appUrl: APP_URL, ai: aiState.client }),
}));

const { db } = await import("@/lib/db");
const { requireUser } = await import("@/lib/auth/session");
const { AiError, createAiClient, createMockProvider } = await import("@/lib/ai");
const { NotFoundError } = await import("@/lib/career/repository");
const { createLogger } = await import("@/lib/logger");
const cards = await import("@/lib/card/repository");
const contacts = await import("@/lib/contact/repository");
const { hashToken } = await import("@/lib/card/tokens");
const actions = await import("@/app/[locale]/app/contacts/actions");
const { default: ContactPage } = await import("@/app/[locale]/app/contacts/[id]/page");

const url = process.env.TEST_DATABASE_URL;
const run = `c${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const NOW = new Date("2026-10-07T12:00:00Z");
const DAY = 24 * 3_600_000;

const logLines: string[] = [];
const logger = createLogger({ level: "debug", write: (_level, line) => logLines.push(line) });

const DRAFT_BODY =
  "Bonjour,\n\nJe suis l’agent de carrière IA d’une personne candidate intéressée par votre offre. Son expérience des pipelines de données temps réel répond à vos besoins.\n\nBien cordialement,";

function mockAi(options: { down?: boolean; body?: string } = {}) {
  const provider = createMockProvider({
    respond: () =>
      options.down
        ? { error: new AiError("unavailable") }
        : JSON.stringify({ body: options.body ?? DRAFT_BODY }),
  });
  return { provider, client: createAiClient({ provider, sleep: async () => {}, backoffMs: 0 }) };
}

type User = { id: string; email: string };

async function newCandidate(label: string): Promise<User> {
  const user = await db.user.create({
    data: { email: `${label}.testard-${run}@exemple.test`, locale: "fr" },
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
  const skill = await db.skill.create({
    data: { userId: user.id, name: "Kafka", nameKey: `kafka` },
  });
  const achievement = await db.achievement.create({
    data: {
      userId: user.id,
      experienceId: experience.id,
      title: "Pipeline de données temps réel",
      result: "Latence divisée par 10",
      evidenceLevel: "DOCUMENT",
    },
  });
  await db.achievementSkill.create({ data: { achievementId: achievement.id, skillId: skill.id } });
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
  return { id: user.id, email: user.email };
}

let offerCount = 0;
async function newOffer(input: {
  applyEmail?: string | null;
  applyEmailPersonal?: boolean;
  applyUrl?: string | null;
  title?: string;
  description?: string;
  salaryMax?: number;
}) {
  const n = ++offerCount;
  return db.jobOffer.create({
    data: {
      id: `${run}-offer-${n}`,
      source: "test-contact",
      sourceKey: `test-contact:${run}`,
      sourceId: `${run}-${n}`,
      url: `https://emplois.exemple.test/${run}/${n}`,
      urlKey: `emplois.exemple.test/${run}/${n}`,
      title: input.title ?? "Data engineer (H/F)",
      companyName: `Initrode ${run}`,
      description:
        input.description ??
        "Nous recherchons une personne pour construire nos pipelines de données temps réel avec Kafka. Le poste est en CDI, en mode hybride, et votre équipe sera basée à Paris.",
      country: "FR",
      remotePolicy: "HYBRID",
      contractType: "CDI",
      salaryMin: 60_000,
      salaryMax: input.salaryMax ?? 70_000,
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      contentHash: `${run}-${n}`,
      applyEmail:
        input.applyEmail === undefined ? "recrutement@initrode.example" : input.applyEmail,
      applyEmailPersonal: input.applyEmailPersonal ?? false,
      applyUrl: input.applyUrl ?? null,
    },
  });
}

async function newMatch(userId: string, offerId: string) {
  return db.match.create({
    data: {
      userId,
      offerId,
      score: 82,
      explanation: {},
      inputHash: "x",
      computedAt: NOW,
    },
  });
}

async function approvedCard(user: User) {
  await cards.regenerateCard(user.id);
  const approval = await cards.approveCard(user.id);
  expect(approval).toEqual({ ok: true });
}

const sendDeps = (now = NOW) => ({
  send: fakeSend,
  appUrl: APP_URL,
  now: () => now,
  logger,
});

describe.skipIf(!url)(
  "prise de contact anonyme : carte, brouillon, approbation, envoi, réponses",
  () => {
    let alice: User;
    let bob: User;

    beforeAll(async () => {
      process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
      alice = await newCandidate("alice");
      bob = await newCandidate("bob");
    });

    beforeEach(() => {
      outbox.length = 0;
      notifications.length = 0;
      fakeSend.mockClear();
      delete process.env.CONTACT_DAILY_LIMIT;
    });

    afterAll(async () => {
      await db.user.deleteMany({ where: { id: { in: [alice?.id, bob?.id].filter(Boolean) } } });
      await db.jobOffer.deleteMany({ where: { sourceKey: `test-contact:${run}` } });
    });

    it("la carte est générée depuis la mémoire, validée seulement sans problème, puis partageable", async () => {
      const state = await cards.getCardState(alice.id);
      expect(state.generated).toBe(true);
      expect(state.card.headline).toBe("Ingénieure data senior");
      expect(state.card.skills).toEqual([{ name: "Kafka", proven: true }]);

      // Un nom tiré de l'e-mail du compte bloque la validation.
      const leaky = { ...state.card, headline: "Ingénieure data — Alice Testard" };
      expect(await cards.saveCard(alice.id, leaky)).toMatchObject({
        ok: true,
        issues: [{ code: "knownTerm", path: "headline" }],
      });
      expect(await cards.approveCard(alice.id)).toMatchObject({ ok: false });
      expect(await cards.shareableCard(alice.id)).toMatchObject({
        ok: false,
        reason: "notApproved",
      });
      expect(await cards.createCardLink(alice.id)).toMatchObject({ ok: false });

      await approvedCard(alice);
      expect(await cards.shareableCard(alice.id)).toMatchObject({ ok: true });

      // Toute modification retire la validation.
      await cards.saveCard(alice.id, { ...state.card, headline: "Ingénieure data" });
      expect(await cards.shareableCard(alice.id)).toMatchObject({
        ok: false,
        reason: "notApproved",
      });
      await approvedCard(alice);
    });

    it("liens publics : jeton imprévisible stocké haché, expiration et révocation", async () => {
      const created = await cards.createCardLink(alice.id, { now: NOW, ttlDays: 7 });
      if (!created.ok) throw new Error("lien attendu");
      const { token, id } = created.link;
      const row = await db.cardLink.findUniqueOrThrow({ where: { id } });
      expect(row.tokenHash).toBe(hashToken(token));
      expect(JSON.stringify(row)).not.toContain(token);

      const view = await cards.resolveCardLink(token, { now: NOW, countView: true });
      expect(view).toMatchObject({ userId: alice.id, contactId: null });
      expect(view?.card.headline).toBe("Ingénieure data senior");
      expect((await db.cardLink.findUniqueOrThrow({ where: { id } })).viewCount).toBe(1);

      // Expiré, jeton modifié, ou forme invalide : rien.
      expect(await cards.resolveCardLink(token, { now: new Date(NOW.getTime() + 8 * DAY) })).toBe(
        null,
      );
      const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
      expect(await cards.resolveCardLink(tampered, { now: NOW })).toBeNull();
      expect(await cards.resolveCardLink({ not: "x" }, { now: NOW })).toBeNull();

      // Un autre candidat ne peut pas révoquer ce lien.
      await expect(cards.revokeCardLink(bob.id, id)).rejects.toThrow(NotFoundError);
      expect(await cards.resolveCardLink(token, { now: NOW })).not.toBeNull();
      await cards.revokeCardLink(alice.id, id, NOW);
      expect(await cards.resolveCardLink(token, { now: NOW })).toBeNull();
    });

    it("brouillon par l'IA simulée, dans la langue de l'offre, puis approbation obligatoire avant envoi", async () => {
      const offer = await newOffer({});
      const match = await newMatch(alice.id, offer.id);
      const ai = mockAi();
      const started = await contacts.startContact(alice.id, match.id, { ai: ai.client, logger });
      if (!started.ok) throw new Error(started.error);
      // Le modèle ne reçoit que la carte validée : ni e-mail du compte ni nom.
      const prompt = JSON.stringify(ai.provider.calls);
      expect(prompt).not.toContain(alice.email);
      expect(prompt).not.toMatch(/testard/i);
      expect(prompt).toContain("Pipeline de données temps réel");

      // Même offre : le contact existant est renvoyé (un seul par offre).
      expect(await contacts.startContact(alice.id, match.id, { ai: null })).toEqual(started);

      const draft = (await contacts.getContact(alice.id, started.id))!;
      expect(draft).toMatchObject({
        status: "DRAFT",
        channel: "EMAIL",
        locale: "fr",
        draftSource: "llm",
        body: DRAFT_BODY,
        approved: false,
        offer: { recipient: "recrutement@initrode.example" },
      });
      expect(draft.subject).toBe("Candidature anonyme – Data engineer (H/F)");

      // Envoi sans approbation : refusé, rien n'est envoyé.
      expect(await contacts.sendContact(alice.id, started.id, sendDeps())).toEqual({
        ok: false,
        error: "notApproved",
      });
      expect(outbox).toEqual([]);

      expect(await contacts.approveDraft(alice.id, started.id, { appUrl: APP_URL })).toEqual({
        ok: true,
      });
      // Modifié après approbation : l'approbation tombe, l'envoi est refusé.
      await contacts.updateDraft(alice.id, started.id, {
        subject: draft.subject,
        body: `${DRAFT_BODY}\n\nDisponible rapidement.`,
      });
      expect((await contacts.getContact(alice.id, started.id))!.approved).toBe(false);
      expect(await contacts.sendContact(alice.id, started.id, sendDeps())).toMatchObject({
        ok: false,
        error: "notApproved",
      });
      // Un nom ajouté au message bloque l'approbation.
      await contacts.updateDraft(alice.id, started.id, {
        subject: draft.subject,
        body: `${DRAFT_BODY}\nAlice`,
      });
      expect(await contacts.approveDraft(alice.id, started.id, { appUrl: APP_URL })).toMatchObject({
        ok: false,
        error: "reidentifying",
      });
      await contacts.updateDraft(alice.id, started.id, {
        subject: draft.subject,
        body: DRAFT_BODY,
      });
      expect(await contacts.approveDraft(alice.id, started.id, { appUrl: APP_URL })).toEqual({
        ok: true,
      });

      logLines.length = 0;
      expect(await contacts.sendContact(alice.id, started.id, sendDeps())).toEqual({ ok: true });
      expect(outbox).toHaveLength(1);
      const mail = outbox[0]!;
      expect(mail.to).toBe("recrutement@initrode.example");
      expect(mail.subject).toBe("Candidature anonyme – Data engineer (H/F)");
      expect(mail.text).toContain(DRAFT_BODY);
      // Transparence (AI Act, art. 50) et liens vers la carte et la page de réponse.
      expect(mail.text).toContain("préparé par un agent IA");
      expect(mail.text).toMatch(/https:\/\/coach\.exemple\.test\/fr\/p\/[A-Za-z0-9_-]{43}\n/);
      expect(mail.text).toMatch(
        /https:\/\/coach\.exemple\.test\/fr\/p\/[A-Za-z0-9_-]{43}\/repondre/,
      );
      expect(mail.text + mail.html).not.toMatch(/testard|alice\./i);

      const sent = (await contacts.getContact(alice.id, started.id))!;
      expect(sent).toMatchObject({ status: "SENT", sentText: mail.text });
      expect(sent.sentAt).toEqual(NOW);
      // Une seule fois : un second envoi est refusé.
      expect(await contacts.sendContact(alice.id, started.id, sendDeps())).toMatchObject({
        ok: false,
        error: "alreadySent",
      });

      // Journal : ni identité, ni adresse de l'entreprise, ni contenu.
      const log = logLines.join("\n");
      expect(log).toContain("contact.sent");
      expect(log).not.toMatch(/initrode\.example|testard|Pipeline|agent de carrière|\/p\//i);
    });

    it("réponse de l'entreprise : page autorisée par le seul jeton d'un contact envoyé", async () => {
      const [contact] = await db.contact.findMany({
        where: { userId: alice.id, status: "SENT" },
        take: 1,
      });
      const token = /\/p\/([A-Za-z0-9_-]{43})\/repondre/.exec(
        (await contacts.getContact(alice.id, contact!.id))!.sentText!,
      )![1]!;
      const target = await contacts.replyTarget(token, NOW);
      expect(target).toMatchObject({ id: contact!.id, offer: { title: "Data engineer (H/F)" } });

      // Lien créé à la main (sans contact) : pas de page de réponse.
      const manual = await cards.createCardLink(alice.id, { now: NOW });
      if (!manual.ok) throw new Error("lien attendu");
      expect(await contacts.replyTarget(manual.link.token, NOW)).toBeNull();
      expect(await contacts.replyTarget("x".repeat(43), NOW)).toBeNull();

      logLines.length = 0;
      const deps = { send: fakeNotify, appUrl: APP_URL, now: () => NOW, logger };
      expect(await contacts.recordReply(token, { body: "  " }, deps)).toEqual({
        ok: false,
        error: "invalid",
      });
      expect(
        await contacts.recordReply(
          token,
          { body: "Bonjour, profil intéressant : écrivez à marie.recruteuse@initrode.example." },
          deps,
        ),
      ).toEqual({ ok: true });
      expect(await contacts.recordReply(manual.link.token, { body: "Bonjour" }, deps)).toEqual({
        ok: false,
        error: "notFound",
      });

      // Le candidat est prévenu, sans le contenu de la réponse.
      expect(notifications).toHaveLength(1);
      expect(notifications[0]!.to).toBe(alice.email);
      expect(notifications[0]!.text).toContain(`/fr/app/contacts/${contact!.id}`);
      expect(notifications[0]!.text).not.toContain("marie.recruteuse");
      expect(logLines.join("\n")).not.toMatch(/marie|initrode/);

      // Réponse chiffrée en base, lisible dans la boîte du candidat.
      const stored = await db.contactReply.findFirstOrThrow({ where: { contactId: contact!.id } });
      expect(stored.bodyEnc).not.toContain("marie");
      const inbox = await contacts.listContacts(alice.id);
      expect(inbox.find((c) => c.id === contact!.id)).toMatchObject({ replies: 1, unread: 1 });
      expect((await contacts.getContact(alice.id, contact!.id))!.replies[0]!.body).toContain(
        "marie.recruteuse",
      );

      // Lien révoqué : plus de carte ni de réponse.
      await db.cardLink.update({ where: { id: contact!.cardLinkId! }, data: { revokedAt: NOW } });
      expect(await contacts.replyTarget(token, NOW)).toBeNull();
      expect(await contacts.recordReply(token, { body: "Relance" }, deps)).toEqual({
        ok: false,
        error: "notFound",
      });
    });

    it("un autre candidat n'atteint ni le contact, ni le brouillon, ni la boîte (404)", async () => {
      const [contact] = await db.contact.findMany({ where: { userId: alice.id }, take: 1 });
      expect(await contacts.getContact(bob.id, contact!.id)).toBeNull();
      await expect(contacts.sendContact(bob.id, contact!.id, sendDeps())).rejects.toThrow(
        NotFoundError,
      );
      await expect(
        contacts.updateDraft(bob.id, contact!.id, { subject: "x", body: "y".repeat(30) }),
      ).rejects.toThrow(NotFoundError);
      await expect(contacts.approveDraft(bob.id, contact!.id, { appUrl: APP_URL })).rejects.toThrow(
        NotFoundError,
      );
      await expect(contacts.sendContact(bob.id, { not: "x" }, sendDeps())).rejects.toThrow(
        NotFoundError,
      );
      expect(await contacts.listContacts(bob.id)).toEqual([]);

      // Correspondance d'Alice utilisée par Bob pour démarrer un contact : 404.
      const match = await db.match.findFirstOrThrow({ where: { userId: alice.id } });
      await expect(contacts.startContact(bob.id, match.id, { ai: null })).rejects.toThrow(
        NotFoundError,
      );

      vi.mocked(requireUser).mockResolvedValue(bob);
      await expect(ContactPage({ params: Promise.resolve({ id: contact!.id }) })).rejects.toThrow(
        /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
      );
      await expect(actions.sendContactAction(contact!.id)).rejects.toThrow(
        /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
      );
    });

    it("l'action d'envoi refuse un brouillon non approuvé ; repli sans IA ; offre anglaise en anglais", async () => {
      vi.mocked(requireUser).mockResolvedValue(bob);
      await approvedCard(bob);
      const offer = await newOffer({
        title: "Senior data engineer",
        description:
          "You will build our real-time data platform with Kafka. We are a remote-friendly team and this role is hybrid, with two days a week in our office.",
      });
      const match = await newMatch(bob.id, offer.id);
      // IA en panne : brouillon déterministe, dans la langue de l'offre.
      const started = await contacts.startContact(bob.id, match.id, {
        ai: mockAi({ down: true }).client,
        logger,
      });
      if (!started.ok) throw new Error(started.error);
      const draft = (await contacts.getContact(bob.id, started.id))!;
      expect(draft).toMatchObject({ locale: "en", draftSource: "rules" });
      expect(draft.subject).toBe("Anonymous application – Senior data engineer");
      expect(draft.body).toContain("I am the AI career agent of a candidate");
      expect(draft.body).toContain("Pipeline de données temps réel");

      expect(await actions.sendContactAction(started.id)).toEqual({ error: "notApproved" });
      expect(outbox).toEqual([]);
      expect(await actions.approveDraftAction(started.id)).toEqual({ ok: "approved" });
      expect(await actions.sendContactAction(started.id)).toEqual({ ok: "sent" });
      expect(outbox).toHaveLength(1);
      expect(outbox[0]!.text).toContain("prepared by an AI agent");
      expect(outbox[0]!.text).toContain("/en/p/");
    });

    it("garde-fou violé après le brouillon : approbation et envoi refusés", async () => {
      const offer = await newOffer({});
      const match = await newMatch(alice.id, offer.id);
      const started = await contacts.startContact(alice.id, match.id, { ai: null });
      if (!started.ok) throw new Error(started.error);
      expect(await contacts.approveDraft(alice.id, started.id, { appUrl: APP_URL })).toEqual({
        ok: true,
      });
      await db.guardRails.update({ where: { userId: alice.id }, data: { minFixedSalary: 90_000 } });
      expect(await contacts.sendContact(alice.id, started.id, sendDeps())).toEqual({
        ok: false,
        error: "guardRail",
      });
      expect(outbox).toEqual([]);
      // L'opportunité elle-même n'est plus visible : impossible d'en démarrer un autre.
      const other = await newMatch(alice.id, (await newOffer({})).id);
      await expect(contacts.startContact(alice.id, other.id, { ai: null })).rejects.toThrow(
        NotFoundError,
      );
      await db.guardRails.update({ where: { userId: alice.id }, data: { minFixedSalary: 55_000 } });
      await db.contact.delete({ where: { id: started.id } });
    });

    it("intitulé daté ou nom de l'entreprise dans le titre : le brouillon de l'agent s'approuve", async () => {
      for (const title of [
        "Alternance chef de produit 2026-2027 (H/F)",
        `Data engineer – Initrode ${run}`,
      ]) {
        const match = await newMatch(alice.id, (await newOffer({ title })).id);
        const started = await contacts.startContact(alice.id, match.id, { ai: null });
        if (!started.ok) throw new Error(started.error);
        const draft = (await contacts.getContact(alice.id, started.id))!;
        expect(draft.body).toContain(title);
        expect(await contacts.approveDraft(alice.id, started.id, { appUrl: APP_URL })).toEqual({
          ok: true,
        });
        await db.contact.delete({ where: { id: started.id } });
      }
    });

    it("quota quotidien d'envois (CONTACT_DAILY_LIMIT) et une prise de contact par offre", async () => {
      process.env.CONTACT_DAILY_LIMIT = "2";
      const already = await contacts.getQuota(alice.id, NOW);
      expect(already).toMatchObject({ limit: 2, sent: 1, remaining: 1 });

      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const match = await newMatch(alice.id, (await newOffer({})).id);
        const started = await contacts.startContact(alice.id, match.id, { ai: null });
        if (!started.ok) throw new Error(started.error);
        await contacts.approveDraft(alice.id, started.id, { appUrl: APP_URL });
        ids.push(started.id);
      }
      expect(await contacts.sendContact(alice.id, ids[0], sendDeps())).toEqual({ ok: true });
      expect(await contacts.sendContact(alice.id, ids[1], sendDeps())).toEqual({
        ok: false,
        error: "quota",
      });
      expect(outbox).toHaveLength(1);
      // Rien n'est perdu : le brouillon reste approuvé, envoyable le lendemain.
      expect((await contacts.getContact(alice.id, ids[1]))!.status).toBe("APPROVED");
      expect(
        await contacts.sendContact(alice.id, ids[1], sendDeps(new Date(NOW.getTime() + DAY + 1))),
      ).toEqual({ ok: true });
      expect(await db.contact.count({ where: { id: { in: ids }, status: "SENT" } })).toBe(2);
    });

    it("offre sans adresse : texte à coller (aucun envoi), adresse nominative jamais affichée", async () => {
      const urlOnly = await newOffer({
        applyEmail: null,
        applyUrl: "https://initrode.example/apply",
      });
      const match = await newMatch(alice.id, urlOnly.id);
      const started = await contacts.startContact(alice.id, match.id, { ai: null });
      if (!started.ok) throw new Error(started.error);
      expect((await contacts.getContact(alice.id, started.id))!.channel).toBe("APPLY_URL");
      expect(await contacts.markSubmitted(alice.id, started.id)).toMatchObject({
        ok: false,
        error: "notApproved",
      });
      await contacts.approveDraft(alice.id, started.id, { appUrl: APP_URL });
      const approved = (await contacts.getContact(alice.id, started.id))!;
      expect(approved.sentText).toContain("préparé par un agent IA");
      expect(approved.sentText).toMatch(/\/fr\/p\/[A-Za-z0-9_-]{43}/);
      // Jamais envoyé par l'application.
      expect(await contacts.sendContact(alice.id, started.id, sendDeps())).toMatchObject({
        ok: false,
      });
      expect(outbox).toEqual([]);
      expect(await contacts.markSubmitted(alice.id, started.id)).toEqual({ ok: true });
      expect((await contacts.getContact(alice.id, started.id))!.status).toBe("SENT");

      const named = await newOffer({
        applyEmail: "jean.fictif@initrode.example",
        applyEmailPersonal: true,
      });
      const namedMatch = await newMatch(alice.id, named.id);
      const namedContact = await contacts.startContact(alice.id, namedMatch.id, { ai: null });
      if (!namedContact.ok) throw new Error(namedContact.error);
      const view = (await contacts.getContact(alice.id, namedContact.id))!;
      expect(view.offer.recipient).toBeNull();
      expect(JSON.stringify(view)).not.toContain("jean.fictif");

      // Offre sans aucun canal : pas de contact.
      const none = await newMatch(alice.id, (await newOffer({ applyEmail: null })).id);
      expect(await contacts.startContact(alice.id, none.id, { ai: null })).toEqual({
        ok: false,
        error: "noChannel",
      });
    });
  },
);
