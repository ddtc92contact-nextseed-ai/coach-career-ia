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
const fakeSend = vi.fn(async (message: MailMessage) => void outbox.push(message));
const fakeNotify = vi.fn(async () => {});
const APP_URL = "https://coach.exemple.test";
vi.mock("@/lib/contact/server", () => ({
  contactDeps: () => ({ send: fakeSend, notify: fakeNotify, appUrl: APP_URL, ai: null }),
}));

const { db } = await import("@/lib/db");
const { requireUser } = await import("@/lib/auth/session");
const { AiError, createAiClient, createMockProvider } = await import("@/lib/ai");
const { entitlementsFor } = await import("@/lib/billing/entitlements");
const { NotFoundError } = await import("@/lib/career/repository");
const { createLogger } = await import("@/lib/logger");
const cards = await import("@/lib/card/repository");
const contacts = await import("@/lib/contact/repository");
const negotiation = await import("@/lib/negotiation/repository");
const actions = await import("@/app/[locale]/app/contacts/negotiation-actions");
const { default: ContactPage } = await import("@/app/[locale]/app/contacts/[id]/page");

const url = process.env.TEST_DATABASE_URL;
const run = `n${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const NOW = new Date("2026-10-07T12:00:00Z");
const LATER = new Date("2026-10-07T15:00:00Z");

const logLines: string[] = [];
const logger = createLogger({ level: "debug", write: (_level, line) => logLines.push(line) });

const PREMIUM = entitlementsFor({ email: "x@exemple.test", plan: "PREMIUM" }, {});
const FREE = entitlementsFor({ email: "x@exemple.test", plan: "FREE" }, {});

const COUNTER =
  "Bonjour,\n\nMerci pour votre proposition. La personne candidate souhaite 62 000 € brut annuel, en CDI, avec 2 jours de télétravail par semaine. Rien n’est engagé sans sa confirmation.\n\nBien cordialement,";
const COMPANY_OFFER =
  "Bonjour Alice Testard, nous pouvons proposer 50 000 € brut annuel en CDI, avec 1 jour de télétravail. Écrivez à rh@initrode.example.";

function mockAi(reply: { body?: string; down?: boolean } = {}) {
  const provider = createMockProvider({
    respond: () =>
      reply.down
        ? { error: new AiError("unavailable") }
        : JSON.stringify({ body: reply.body ?? COUNTER }),
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
      minRemoteDays: 2,
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
async function sentContact(user: User) {
  const n = ++offerCount;
  const offer = await db.jobOffer.create({
    data: {
      id: `${run}-offer-${n}`,
      source: "test-negotiation",
      sourceKey: `test-negotiation:${run}`,
      sourceId: `${run}-${n}`,
      url: `https://emplois.exemple.test/${run}/${n}`,
      urlKey: `emplois.exemple.test/${run}/${n}`,
      title: "Data engineer (H/F)",
      companyName: `Initrode ${run}`,
      description:
        "Nous recherchons une personne pour construire nos pipelines de données temps réel avec Kafka. Le poste est en CDI, en mode hybride, et votre équipe sera basée à Paris.",
      country: "FR",
      remotePolicy: "HYBRID",
      contractType: "CDI",
      salaryMin: 55_000,
      salaryMax: 65_000,
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      contentHash: `${run}-${n}`,
      applyEmail: "recrutement@initrode.example",
    },
  });
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
  if (!started.ok) throw new Error(started.error);
  expect(await contacts.approveDraft(user.id, started.id, { appUrl: APP_URL })).toEqual({
    ok: true,
  });
  const sent = await contacts.sendContact(user.id, started.id, {
    send: fakeSend,
    appUrl: APP_URL,
    now: () => NOW,
  });
  expect(sent).toEqual({ ok: true });
  const text = (await contacts.getContact(user.id, started.id))!.sentText!;
  const token = /\/p\/([A-Za-z0-9_-]{43})\/repondre/.exec(text)![1]!;
  return { id: started.id, token };
}

const MANDATE_FORM = {
  salaryFloor: "55 000",
  salaryTarget: "62k",
  remoteDaysMin: "2",
  contractType: "CDI",
  location: "",
  startDate: "",
  title: "",
  otherPoints: "",
  niceToHave: "Budget formation",
  facts: "",
};

const sendDeps = (now = LATER) => ({ send: fakeSend, appUrl: APP_URL, now: () => now, logger });
const REPLIED = new Date("2026-10-07T16:00:00Z");
const replyDeps = { send: fakeNotify, appUrl: APP_URL, now: () => REPLIED, logger };

describe.skipIf(!url)(
  "agent de négociation : mandat, brouillons approuvés, envoi, réponses",
  () => {
    let alice: User;
    let bob: User;
    let contact: { id: string; token: string };

    beforeAll(async () => {
      process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
      alice = await newCandidate("alice");
      bob = await newCandidate("bob");
      contact = await sentContact(alice);
      // Première réponse de l'entreprise, avant toute négociation : réponse du contact.
      expect(await contacts.recordReply(contact.token, { body: COMPANY_OFFER }, replyDeps)).toEqual(
        {
          ok: true,
        },
      );
    });

    beforeEach(() => {
      outbox.length = 0;
      fakeSend.mockClear();
      delete process.env.CONTACT_DAILY_LIMIT;
    });

    afterAll(async () => {
      await db.user.deleteMany({ where: { id: { in: [alice?.id, bob?.id].filter(Boolean) } } });
      await db.jobOffer.deleteMany({ where: { sourceKey: `test-negotiation:${run}` } });
    });

    it("un autre candidat n'atteint ni la négociation, ni ses actions (404)", async () => {
      await expect(negotiation.getNegotiation(bob.id, contact.id)).rejects.toThrow(NotFoundError);
      await expect(negotiation.saveMandate(bob.id, contact.id, MANDATE_FORM)).rejects.toThrow(
        NotFoundError,
      );
      await expect(
        negotiation.generateDraft(bob.id, contact.id, "counter", {
          ai: null,
          entitlements: PREMIUM,
        }),
      ).rejects.toThrow(NotFoundError);
      await expect(negotiation.setOutcome(bob.id, contact.id, "ACCEPTED")).rejects.toThrow(
        NotFoundError,
      );
      await expect(negotiation.getNegotiation(alice.id, { not: "x" })).rejects.toThrow(
        NotFoundError,
      );

      vi.mocked(requireUser).mockResolvedValue(bob);
      await expect(
        ContactPage({
          params: Promise.resolve({ id: contact.id }),
          searchParams: Promise.resolve({ onglet: "negocier" }),
        }),
      ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
      await expect(actions.generateDraftAction(contact.id, "counter")).rejects.toThrow(
        /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
      );
      const form = new FormData();
      for (const [k, v] of Object.entries(MANDATE_FORM)) form.set(k, v);
      await expect(actions.saveMandateAction(contact.id, {}, form)).rejects.toThrow(
        /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
      );
    });

    it("mandat : plancher par défaut des garde-fous, validation, chiffrement, analyse", async () => {
      const before = await negotiation.getNegotiation(alice.id, contact.id);
      expect(before).toMatchObject({
        sent: true,
        mandate: null,
        status: null,
        hasReplies: true,
        analysis: null,
        defaults: { salaryFloor: 55_000, remoteDaysMin: 2, contractType: "CDI" },
      });

      expect(
        await negotiation.saveMandate(alice.id, contact.id, { ...MANDATE_FORM, salaryFloor: 1 }),
      ).toMatchObject({ ok: false, error: "invalid" });

      vi.mocked(requireUser).mockResolvedValue(alice);
      const form = new FormData();
      for (const [k, v] of Object.entries(MANDATE_FORM)) form.set(k, v);
      expect(await actions.saveMandateAction(contact.id, {}, form)).toEqual({ ok: "saved" });

      const row = await db.negotiationMandate.findUniqueOrThrow({
        where: { contactId: contact.id },
      });
      expect(row.contentEnc).not.toContain("55000");
      expect(row.contentEnc).not.toContain("Budget");

      const view = await negotiation.getNegotiation(alice.id, contact.id);
      expect(view.mandate).toMatchObject({ salaryFloor: 55_000, salaryTarget: 62_000 });
      expect(view.status).toBe("ACTIVE");
      // Estimation à partir de la réponse de l'entreprise.
      expect(view.analysis).toMatchObject({
        salary: { offered: 50_000, status: "belowFloor" },
        remote: { offered: 1, status: "notMet" },
        contract: { offered: "CDI", status: "met" },
      });
    });

    it("contre-proposition réservée à Premium (droit `negotiation`)", async () => {
      expect(
        await negotiation.generateDraft(alice.id, contact.id, "counter", {
          ai: mockAi().client,
          entitlements: FREE,
        }),
      ).toEqual({ ok: false, error: "premium" });
      vi.mocked(requireUser).mockResolvedValue(alice);
      // L'action lit les droits en base : Alice est sur l'offre gratuite.
      expect(await actions.generateDraftAction(contact.id, "counter")).toMatchObject({
        error: "premium",
      });
      expect(await db.negotiationMessage.count({ where: { contactId: contact.id } })).toBe(0);
    });

    it("brouillon de l'IA → approbation liée au texte → envoi avec mention de transparence", async () => {
      const ai = mockAi();
      logLines.length = 0;
      const generated = await negotiation.generateDraft(
        alice.id,
        contact.id,
        "counter",
        { ai: ai.client, entitlements: PREMIUM, logger },
        NOW,
      );
      expect(generated).toEqual({ ok: true, source: "llm" });
      // Le modèle ne reçoit ni le nom du candidat, ni son e-mail, ni les coordonnées de l'entreprise.
      const prompt = JSON.stringify(ai.provider.calls);
      expect(prompt).not.toMatch(/testard/i);
      expect(prompt).not.toContain(alice.email);
      expect(prompt).not.toContain("rh@initrode.example");
      expect(prompt).toContain("50 000 €");

      let view = await negotiation.getNegotiation(alice.id, contact.id);
      const id = view.pending!.id;
      expect(view.pending).toMatchObject({ body: COUNTER, approved: false, draftSource: "llm" });

      // Envoi sans approbation : refusé.
      expect(await negotiation.sendMessage(alice.id, contact.id, id, sendDeps())).toEqual({
        ok: false,
        error: "notApproved",
      });
      expect(
        await negotiation.approveMessage(alice.id, contact.id, id, { appUrl: APP_URL }),
      ).toEqual({
        ok: true,
      });
      // Modifié après approbation : l'approbation tombe, l'envoi est refusé.
      await negotiation.updateMessage(alice.id, contact.id, id, { body: `${COUNTER}\nÀ bientôt.` });
      view = await negotiation.getNegotiation(alice.id, contact.id);
      expect(view.pending!.approved).toBe(false);
      expect(await negotiation.sendMessage(alice.id, contact.id, id, sendDeps())).toMatchObject({
        ok: false,
        error: "notApproved",
      });
      // Sous le plancher : bloqué, jamais un simple avertissement.
      await negotiation.updateMessage(alice.id, contact.id, id, {
        body: "Bonjour,\n\nElle accepterait finalement 52 000 € brut annuel.\n\nCordialement,",
      });
      expect(
        await negotiation.approveMessage(alice.id, contact.id, id, { appUrl: APP_URL }),
      ).toMatchObject({ ok: false, error: "blocked", issues: [{ code: "belowFloor" }] });
      expect((await negotiation.getNegotiation(alice.id, contact.id)).pendingIssues).toMatchObject([
        { code: "belowFloor" },
      ]);
      // Offre concurrente non déclarée au mandat : bloquée aussi.
      await negotiation.updateMessage(alice.id, contact.id, id, {
        body: "Bonjour,\n\nElle a reçu une autre offre et souhaite 62 000 €.\n\nCordialement,",
      });
      expect(
        await negotiation.approveMessage(alice.id, contact.id, id, { appUrl: APP_URL }),
      ).toMatchObject({ ok: false, error: "blocked", issues: [{ code: "competingOffer" }] });

      await negotiation.updateMessage(alice.id, contact.id, id, { body: COUNTER });
      expect(
        await negotiation.approveMessage(alice.id, contact.id, id, { appUrl: APP_URL }),
      ).toEqual({
        ok: true,
      });
      expect(await negotiation.sendMessage(alice.id, contact.id, id, sendDeps())).toEqual({
        ok: true,
      });
      expect(outbox).toHaveLength(1);
      const mail = outbox[0]!;
      expect(mail.to).toBe("recrutement@initrode.example");
      expect(mail.subject).toBe("Négociation – Data engineer (H/F)");
      expect(mail.text).toContain(COUNTER);
      expect(mail.text).toContain(
        "rédigé par l’assistant IA (Coach Career IA) de la personne candidate, qui l’a relu et approuvé",
      );
      // Double envoi impossible.
      expect(await negotiation.sendMessage(alice.id, contact.id, id, sendDeps())).toMatchObject({
        ok: false,
        error: "alreadySent",
      });
      // Journal : codes seulement, jamais le texte.
      const logs = logLines.join("\n");
      expect(logs).toContain("negotiation.sent");
      expect(logs).not.toMatch(/62 000|télétravail|testard|initrode/i);

      // La réponse via le lien du message rejoint le fil de négociation.
      const token = /\/p\/([A-Za-z0-9_-]{43})\/repondre/.exec(mail.text)![1]!;
      expect(await contacts.replyTarget(token, REPLIED)).toMatchObject({ id: contact.id });
      expect(
        await contacts.recordReply(
          token,
          { body: "D’accord pour 60 000 € en CDI et 2 jours de télétravail." },
          replyDeps,
        ),
      ).toEqual({ ok: true });
      expect(await db.contactReply.count({ where: { contactId: contact.id } })).toBe(1);
      view = await negotiation.getNegotiation(alice.id, contact.id);
      expect(view.pending).toBeNull();
      expect(view.messages.map((m) => [m.direction, m.status])).toEqual([
        ["OUT", "SENT"],
        ["IN", "SENT"],
      ]);
      expect(view.analysis).toMatchObject({
        salary: { offered: 60_000, status: "aboveFloor" },
        remote: { status: "met" },
      });
      const inbox = await contacts.listContacts(alice.id);
      expect(inbox.find((c) => c.id === contact.id)).toMatchObject({ replies: 2, unread: 2 });
      await contacts.markRepliesRead(alice.id, contact.id);
      expect(await contacts.unreadReplies(alice.id)).toBe(0);
    });

    it("fournisseur en panne : modèle déterministe et code d'erreur visible", async () => {
      const result = await negotiation.generateDraft(alice.id, contact.id, "counter", {
        ai: mockAi({ down: true }).client,
        entitlements: PREMIUM,
      });
      expect(result).toEqual({ ok: true, source: "rules", fallback: "unavailable" });
      const view = await negotiation.getNegotiation(alice.id, contact.id);
      expect(view.pending).toMatchObject({ draftSource: "rules", kind: "counter" });
      expect(view.pending!.body).toMatch(/62\s000/u);
      expect(view.pendingIssues).toEqual([]);
    });

    it("quota quotidien commun avec les prises de contact", async () => {
      process.env.CONTACT_DAILY_LIMIT = "2";
      const view = await negotiation.getNegotiation(alice.id, contact.id);
      const id = view.pending!.id;
      expect(
        await negotiation.approveMessage(alice.id, contact.id, id, { appUrl: APP_URL }),
      ).toEqual({
        ok: true,
      });
      // Déjà 2 e-mails sur 24 h (le contact, puis la contre-proposition).
      expect(await negotiation.sendMessage(alice.id, contact.id, id, sendDeps())).toEqual({
        ok: false,
        error: "quota",
      });
      expect(outbox).toEqual([]);
      expect((await negotiation.getNegotiation(alice.id, contact.id)).pending).toMatchObject({
        status: "APPROVED",
      });
    });

    it("décision du candidat, puis message de clôture approuvé ; rien n'est envoyé seul", async () => {
      expect(await negotiation.setOutcome(alice.id, contact.id, "ACCEPTED")).toEqual({ ok: true });
      let view = await negotiation.getNegotiation(alice.id, contact.id);
      expect(view.status).toBe("ACCEPTED");
      // La contre-proposition en attente devient sans objet.
      expect(view.pending).toBeNull();
      expect(
        await negotiation.generateDraft(alice.id, contact.id, "counter", {
          ai: null,
          entitlements: PREMIUM,
        }),
      ).toEqual({ ok: false, error: "closed" });
      expect(
        await negotiation.generateDraft(alice.id, contact.id, "closing", {
          ai: null,
          entitlements: PREMIUM,
        }),
      ).toEqual({ ok: true, source: "rules" });
      view = await negotiation.getNegotiation(alice.id, contact.id);
      expect(view.pending).toMatchObject({ kind: "closing", status: "DRAFT", approved: false });
      expect(view.pending!.body).toContain("souhaite avancer sur cette base");
      expect(outbox).toEqual([]);

      // Reprise : le message de clôture est retiré.
      await negotiation.setOutcome(alice.id, contact.id, "ACTIVE");
      view = await negotiation.getNegotiation(alice.id, contact.id);
      expect(view).toMatchObject({ status: "ACTIVE", pending: null });
      await expect(negotiation.setOutcome(alice.id, contact.id, "SIGNED")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("contact non envoyé : pas de négociation", async () => {
      const n = ++offerCount;
      const offer = await db.jobOffer.create({
        data: {
          id: `${run}-offer-${n}`,
          source: "test-negotiation",
          sourceKey: `test-negotiation:${run}`,
          sourceId: `${run}-${n}`,
          url: `https://emplois.exemple.test/${run}/${n}`,
          urlKey: `emplois.exemple.test/${run}/${n}`,
          title: "Analytics engineer",
          companyName: `Initrode ${run}`,
          description: "Nous recherchons une personne pour nos pipelines de données avec Kafka.",
          country: "FR",
          firstSeenAt: NOW,
          lastSeenAt: NOW,
          contentHash: `${run}-${n}`,
          applyEmail: "recrutement@initrode.example",
        },
      });
      const draft = await db.contact.create({
        data: {
          userId: alice.id,
          offerId: offer.id,
          channel: "EMAIL",
          locale: "fr",
          subjectEnc: "x",
          bodyEnc: "x",
          draftSource: "rules",
        },
      });
      expect(await negotiation.saveMandate(alice.id, draft.id, MANDATE_FORM)).toEqual({
        ok: false,
        error: "notSent",
      });
    });
  },
);
