import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";
import type { AiClient } from "@/lib/ai/client";
import { hasFeature, type Entitlements } from "@/lib/billing/entitlements";
import { cardIdentityTerms, createCardLink } from "@/lib/card/repository";
import type { ReidentificationIssue } from "@/lib/card/reidentify";
import { replyPath } from "@/lib/card/tokens";
import { CONTRACT_TYPES, type ContractTypeCode } from "@/lib/career/codes";
import { getGuardRails, NotFoundError } from "@/lib/career/repository";
import { contactDailyLimit } from "@/lib/contact/config";
import { decryptReply, sentInWindow } from "@/lib/contact/repository";
import { db } from "@/lib/db";
import { redactText } from "@/lib/import/pseudonymise";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import type { MailSender } from "@/lib/mail/smtp";
import { annualEur } from "@/lib/radar/benchmarks/compute";
import { BENCHMARK_CONFIG } from "@/lib/radar/benchmarks/config";
import { benchmarkForOffer, type SalaryBenchmark } from "@/lib/radar/salary-benchmarks";
import { analyseOffer, type OfferAnalysis } from "./analysis";
import { checkOutgoing, type NegotiationIssue } from "./check";
import {
  buildNegotiationDraft,
  identityIssues,
  MAX_MESSAGE,
  type DraftKind,
  type NegotiationFacts,
} from "./draft";
import { negotiationEmail, negotiationPasteText } from "./email";
import {
  defaultMandate,
  mandateSchema,
  parseMandate,
  type Mandate,
  type MandateField,
  type NegotiationOutcome,
} from "./mandate";
import { mandateHints, marketForNegotiation, type MarketBenchmark } from "./market";
import { decNegotiation, encNegotiation, messageHash } from "./store";

/**
 * Agent de négociation d'un contact ENVOYÉ : mandat du candidat, fil des
 * messages, brouillons de l'agent, approbation et envoi.
 *
 * Mêmes règles que les prises de contact : l'agent ne fait que rédiger ; seul
 * un message APPROUVÉ par le candidat, et inchangé depuis (`approvedHash`),
 * peut partir, par le canal de l'offre (e-mail de la plateforme, quota commun)
 * ou en texte à transmettre soi-même. Un texte sous le plancher, qui concède
 * un point non négociable ou avance un fait non déclaré est BLOQUÉ.
 * L'application n'accepte jamais rien à la place du candidat.
 *
 * Toutes les requêtes sont filtrées par `userId` : le contact d'un autre
 * candidat est traité comme inexistant (`NotFoundError` → 404). Journal :
 * codes seulement, jamais de texte.
 */

export type NegotiationError =
  | "notSent"
  | "noMandate"
  | "premium"
  | "closed"
  | "notClosed"
  | "blocked"
  | "reidentifying"
  | "notApproved"
  | "alreadySent"
  | "card"
  | "quota"
  | "noChannel"
  | "sendUnavailable"
  | "sendFailed";

export type NegotiationResult<T = object> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error: NegotiationError;
      issues?: NegotiationIssue[];
      identity?: ReidentificationIssue[];
    };

const asId = (id: unknown): string => {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) throw new NotFoundError();
  return id;
};

const PENDING = ["DRAFT", "APPROVED", "SENDING"] as const;

async function ownedContact(userId: string, contactId: unknown) {
  const row = await db.contact.findFirst({
    where: { id: asId(contactId), userId },
    select: {
      id: true,
      status: true,
      channel: true,
      locale: true,
      revealedAt: true,
      offer: {
        select: {
          title: true,
          companyName: true,
          applyEmail: true,
          salaryMin: true,
          salaryMax: true,
          salaryCurrency: true,
          salaryPeriod: true,
          seniority: true,
          country: true,
          region: true,
          remotePolicy: true,
        },
      },
      negotiationMandate: true,
    },
  });
  if (!row) throw new NotFoundError();
  return row;
}
type OwnedContact = Awaited<ReturnType<typeof ownedContact>>;

const localeOf = (row: { locale: string }): AppLocale =>
  isAppLocale(row.locale) ? row.locale : DEFAULT_LOCALE;

function readMandate(userId: string, contentEnc: string): Mandate | null {
  const parsed = mandateSchema.safeParse(JSON.parse(decNegotiation(userId, contentEnc)));
  return parsed.success ? parsed.data : null;
}

/** Messages de l'entreprise (réponses au contact, puis dans la négociation), déchiffrés, du plus ancien au plus récent. */
async function decryptedCompanyTexts(userId: string, contactId: string) {
  const [replies, incoming] = await Promise.all([
    db.contactReply.findMany({
      where: { userId, contactId },
      select: { bodyEnc: true, createdAt: true },
    }),
    db.negotiationMessage.findMany({
      where: { userId, contactId, direction: "IN" },
      select: { bodyEnc: true, createdAt: true },
    }),
  ]);
  return [
    ...replies.map((r) => ({ createdAt: r.createdAt, text: decryptReply(userId, r.bodyEnc) })),
    ...incoming.map((m) => ({ createdAt: m.createdAt, text: decNegotiation(userId, m.bodyEnc) })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Repère de salaire du marché pour l'offre du contact (famille × séniorité ×
 * zone de l'OFFRE, jamais de données du candidat), `null` sous le seuil
 * d'échantillon ; et maximum annoncé par l'offre, annualisé en euros.
 */
async function offerMarket(offer: OwnedContact["offer"]) {
  const salary = {
    ...offer,
    salaryMin: offer.salaryMin === null ? null : Number(offer.salaryMin),
    salaryMax: offer.salaryMax === null ? null : Number(offer.salaryMax),
  };
  const found = await benchmarkForOffer(db, salary).catch(() => null);
  const benchmark: SalaryBenchmark | null = marketForNegotiation(
    found?.benchmark,
    BENCHMARK_CONFIG.minSample,
  );
  const max = salary.salaryMax ?? salary.salaryMin;
  const offerMax = max === null ? null : annualEur({ ...salary, salaryMin: max, salaryMax: max });
  return { benchmark, offerMaxAnnual: offerMax === null ? null : Math.round(offerMax) };
}

const forDraft = (b: SalaryBenchmark | null): MarketBenchmark | null =>
  b && {
    p25: b.p25,
    median: b.median,
    p75: b.p75,
    sampleSize: b.sampleSize,
    scope: b.scope,
    area: b.area,
  };

// --- Lecture --------------------------------------------------------------------------

/** Vue de la négociation d'un contact du candidat. */
export async function getNegotiation(userId: string, contactId: unknown) {
  const contact = await ownedContact(userId, contactId);
  const sent = contact.status === "SENT";
  const mandateRow = contact.negotiationMandate;
  const mandate = mandateRow ? readMandate(userId, mandateRow.contentEnc) : null;
  const [rails, rows, texts, market] = await Promise.all([
    getGuardRails(userId),
    db.negotiationMessage.findMany({
      where: { userId, contactId: contact.id },
      orderBy: { createdAt: "asc" },
    }),
    sent ? decryptedCompanyTexts(userId, contact.id) : Promise.resolve([]),
    sent ? offerMarket(contact.offer) : Promise.resolve(null),
  ]);
  // Fil dans l'ordre des échanges : envoi (ou réception) plutôt que création du brouillon.
  const at = (m: { sentAt: Date | null; createdAt: Date }) => (m.sentAt ?? m.createdAt).getTime();
  rows.sort((a, b) => at(a) - at(b));
  const messages = rows.map((m) => {
    const body = decNegotiation(userId, m.bodyEnc);
    return {
      id: m.id,
      direction: m.direction,
      kind: m.kind,
      status: m.status,
      draftSource: m.draftSource,
      body,
      approved: m.status === "APPROVED" && m.approvedHash === messageHash(body),
      approvedAt: m.approvedAt,
      sentText: m.sentTextEnc ? decNegotiation(userId, m.sentTextEnc) : null,
      sentAt: m.sentAt,
      readAt: m.readAt,
      lastError: m.lastError,
      createdAt: m.createdAt,
    };
  });
  const pending =
    messages.find(
      (m) => m.direction === "OUT" && (PENDING as readonly string[]).includes(m.status),
    ) ?? null;
  const latest = texts.at(-1) ?? null;
  const analysis: OfferAnalysis | null =
    mandate && latest ? analyseOffer(latest.text, mandate) : null;
  const defaults = defaultMandate({
    minFixedSalary: rails.minFixedSalary,
    targetTotalPackage: rails.targetTotalPackage,
    minRemoteDays: rails.minRemoteDays,
    contractTypes: rails.contractTypes.filter((c): c is ContractTypeCode =>
      (CONTRACT_TYPES as readonly string[]).includes(c),
    ),
  });
  return {
    contactId: contact.id,
    sent,
    channel: contact.channel,
    locale: localeOf(contact),
    revealed: Boolean(contact.revealedAt),
    hasReplies: texts.length > 0,
    status: (mandateRow?.status ?? null) as NegotiationOutcome | null,
    closedAt: mandateRow?.closedAt ?? null,
    mandate,
    defaults,
    /**
     * Repère du marché pour l'offre (`benchmark: null` : pas assez de données)
     * et conseils sur le mandat enregistré (ou, à défaut, les valeurs par défaut).
     */
    market: market && {
      ...market,
      hints: mandateHints(mandate ?? defaults, market.benchmark, market.offerMaxAnnual),
    },
    messages: messages.filter((m) => m !== pending),
    pending,
    /** Problèmes bloquants du brouillon en cours, au regard du mandat actuel. */
    pendingIssues: pending && mandate ? checkOutgoing(pending.body, mandate) : [],
    analysis,
    analysedAt: latest?.createdAt ?? null,
  };
}
export type NegotiationView = Awaited<ReturnType<typeof getNegotiation>>;

// --- Mandat ---------------------------------------------------------------------------

export async function saveMandate(
  userId: string,
  contactId: unknown,
  input: unknown,
): Promise<NegotiationResult | { ok: false; error: "invalid"; fields: MandateField[] }> {
  const contact = await ownedContact(userId, contactId);
  if (contact.status !== "SENT") return { ok: false, error: "notSent" };
  const parsed = parseMandate(input);
  if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.fields };
  const contentEnc = encNegotiation(userId, JSON.stringify(parsed.mandate));
  await db.negotiationMandate.upsert({
    where: { contactId: contact.id },
    create: { userId, contactId: contact.id, contentEnc },
    update: { contentEnc },
  });
  return { ok: true };
}

/** Décision du candidat. Jamais prise par l'agent. */
export async function setOutcome(
  userId: string,
  contactId: unknown,
  outcome: unknown,
  now = new Date(),
): Promise<NegotiationResult> {
  const contact = await ownedContact(userId, contactId);
  const status = z.enum(["ACTIVE", "PAUSED", "ACCEPTED", "DECLINED"]).safeParse(outcome);
  if (!status.success) throw new NotFoundError();
  if (!contact.negotiationMandate) return { ok: false, error: "noMandate" };
  await db.negotiationMandate.updateMany({
    where: { contactId: contact.id, userId },
    data: {
      status: status.data,
      closedAt: status.data === "ACCEPTED" || status.data === "DECLINED" ? now : null,
    },
  });
  // Un brouillon devenu hors sujet (contre-proposition après décision, ou
  // clôture après reprise) est retiré ; un envoi en cours n'est pas touché.
  const stale = status.data === "ACTIVE" ? "closing" : "counter";
  await discardPending(userId, contact.id, now, { kind: stale });
  return { ok: true };
}

// --- Brouillons -----------------------------------------------------------------------

export type DraftDeps = {
  ai: AiClient | null;
  entitlements: Entitlements;
  logger?: Logger;
  timeoutMs?: number;
};

const EMAIL_IN_TEXT = /[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[a-z]{2,}/giu;
const PHONE_IN_TEXT =
  /(?:\+|\b00)\d{1,3}[\s.-]?(?:\(0\)[\s.-]?)?\d(?:[\s.-]?\d){6,11}\b|\b0\d(?:[\s.-]?\d{2}){4}\b/g;
const URL_IN_TEXT = /\bhttps?:\/\/\S+/giu;

/** Message de l'entreprise prêt pour le modèle : identité du candidat et coordonnées retirées. */
function forModel(text: string, terms: string[]): string {
  return redactText(text, terms)
    .text.replace(EMAIL_IN_TEXT, "[…]")
    .replace(URL_IN_TEXT, "[…]")
    .replace(PHONE_IN_TEXT, "[…]");
}

/**
 * « Générer une contre-proposition » (ou le message de clôture après une
 * décision) : remplace le brouillon en cours. Fonction Premium.
 */
export async function generateDraft(
  userId: string,
  contactId: unknown,
  kind: DraftKind,
  deps: DraftDeps,
  now = new Date(),
): Promise<NegotiationResult<{ source: "llm" | "rules"; fallback?: string }>> {
  const log = deps.logger ?? defaultLogger;
  const contact = await ownedContact(userId, contactId);
  if (contact.status !== "SENT") return { ok: false, error: "notSent" };
  if (!hasFeature(deps.entitlements, "negotiation")) return { ok: false, error: "premium" };
  const row = contact.negotiationMandate;
  const mandate = row ? readMandate(userId, row.contentEnc) : null;
  if (!row || !mandate) return { ok: false, error: "noMandate" };
  if (kind === "counter" && row.status !== "ACTIVE") return { ok: false, error: "closed" };
  if (kind === "closing" && row.status === "ACTIVE") return { ok: false, error: "notClosed" };
  const sending = await db.negotiationMessage.count({
    where: { userId, contactId: contact.id, direction: "OUT", status: "SENDING" },
  });
  if (sending > 0) return { ok: false, error: "alreadySent" };

  const [terms, texts, market] = await Promise.all([
    cardIdentityTerms(userId),
    decryptedCompanyTexts(userId, contact.id),
    offerMarket(contact.offer),
  ]);
  const locale = localeOf(contact);
  const companyMessages = texts.map((t) => forModel(t.text, terms));
  const facts: NegotiationFacts = {
    locale,
    offerTitle: contact.offer.title,
    companyName: contact.offer.companyName,
    mandate,
    companyMessages,
    analysis: texts.length > 0 ? analyseOffer(texts.at(-1)!.text, mandate) : null,
    offerSalary: {
      min: contact.offer.salaryMin === null ? null : Number(contact.offer.salaryMin),
      max: contact.offer.salaryMax === null ? null : Number(contact.offer.salaryMax),
    },
    outcome: row.status,
    market: forDraft(market.benchmark),
  };
  const draft = await buildNegotiationDraft(
    kind,
    facts,
    deps.ai,
    { terms, revealed: Boolean(contact.revealedAt) },
    { timeoutMs: deps.timeoutMs },
  );
  await storeDraft(userId, contact.id, kind, draft, now);
  log.info("negotiation.draft.created", {
    kind,
    locale,
    source: draft.source,
    fallback: draft.fallback ?? null,
  });
  return {
    ok: true,
    source: draft.source,
    ...(draft.fallback ? { fallback: draft.fallback } : {}),
  };
}

async function storeDraft(
  userId: string,
  contactId: string,
  kind: DraftKind,
  draft: { body: string; source: string },
  now: Date,
) {
  const data = {
    kind,
    bodyEnc: encNegotiation(userId, draft.body),
    draftSource: draft.source,
    status: "DRAFT" as const,
    approvedHash: null,
    approvedAt: null,
    sentTextEnc: null,
    cardLinkId: null,
    lastError: null,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = await db.negotiationMessage.findFirst({
      where: { userId, contactId, direction: "OUT", status: { in: ["DRAFT", "APPROVED"] } },
    });
    if (pending) {
      const { count } = await db.negotiationMessage.updateMany({
        where: { id: pending.id, userId, status: { in: ["DRAFT", "APPROVED"] } },
        data,
      });
      if (count > 0) {
        await dropPreparedLink(userId, pending.cardLinkId, now);
        return;
      }
      continue;
    }
    try {
      await db.negotiationMessage.create({
        data: { ...data, userId, contactId, direction: "OUT" },
      });
      return;
    } catch (error) {
      // Double clic : l'index « un brouillon par contact » a joué, on remplace.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
    }
  }
}

async function dropPreparedLink(userId: string, cardLinkId: string | null, now: Date) {
  if (!cardLinkId) return;
  await db.cardLink.updateMany({
    where: { id: cardLinkId, userId, revokedAt: null },
    data: { revokedAt: now },
  });
}

async function discardPending(
  userId: string,
  contactId: string,
  now: Date,
  filter: { kind?: string; id?: string } = {},
) {
  const rows = await db.negotiationMessage.findMany({
    where: {
      userId,
      contactId,
      direction: "OUT",
      status: { in: ["DRAFT", "APPROVED"] },
      ...filter,
    },
    select: { id: true, cardLinkId: true },
  });
  if (rows.length === 0) return 0;
  await db.negotiationMessage.deleteMany({
    where: { id: { in: rows.map((r) => r.id) }, userId, status: { in: ["DRAFT", "APPROVED"] } },
  });
  for (const r of rows) await dropPreparedLink(userId, r.cardLinkId, now);
  return rows.length;
}

async function ownedMessage(userId: string, contactId: string, messageId: unknown) {
  const row = await db.negotiationMessage.findFirst({
    where: { id: asId(messageId), userId, contactId, direction: "OUT" },
  });
  if (!row) throw new NotFoundError();
  return row;
}

export const messageInput = z.object({ body: z.string().trim().min(20).max(MAX_MESSAGE) });

/** Le candidat modifie le brouillon : l'approbation tombe. */
export async function updateMessage(
  userId: string,
  contactId: unknown,
  messageId: unknown,
  input: unknown,
  now = new Date(),
): Promise<NegotiationResult | { ok: false; error: "invalid" }> {
  const contact = await ownedContact(userId, contactId);
  const row = await ownedMessage(userId, contact.id, messageId);
  const parsed = messageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { count } = await db.negotiationMessage.updateMany({
    where: { id: row.id, userId, status: { in: ["DRAFT", "APPROVED"] } },
    data: {
      bodyEnc: encNegotiation(userId, parsed.data.body),
      status: "DRAFT",
      approvedHash: null,
      approvedAt: null,
      sentTextEnc: null,
      cardLinkId: null,
    },
  });
  if (count === 0) return { ok: false, error: "alreadySent" };
  await dropPreparedLink(userId, row.cardLinkId, now);
  return { ok: true };
}

export async function discardMessage(
  userId: string,
  contactId: unknown,
  messageId: unknown,
  now = new Date(),
) {
  const contact = await ownedContact(userId, contactId);
  const row = await ownedMessage(userId, contact.id, messageId);
  await discardPending(userId, contact.id, now, { id: row.id });
}

/** Contrôles communs à l'approbation et à l'envoi : mandat, plancher, faits, anonymat. */
async function preflight(
  userId: string,
  contact: OwnedContact,
  row: { bodyEnc: string },
): Promise<NegotiationResult<{ body: string }>> {
  if (contact.status !== "SENT") return { ok: false, error: "notSent" };
  const mandate = contact.negotiationMandate
    ? readMandate(userId, contact.negotiationMandate.contentEnc)
    : null;
  if (!mandate) return { ok: false, error: "noMandate" };
  const body = decNegotiation(userId, row.bodyEnc);
  const issues = checkOutgoing(body, mandate);
  if (issues.length > 0) return { ok: false, error: "blocked", issues };
  if (!contact.revealedAt) {
    const target = { offerTitle: contact.offer.title, companyName: contact.offer.companyName };
    const identity = identityIssues(body, await cardIdentityTerms(userId), target);
    if (identity.length > 0) return { ok: false, error: "reidentifying", identity };
  }
  return { ok: true, body };
}

export type SendDeps = {
  send: MailSender | null;
  appUrl: string | null;
  now?: () => Date;
  logger?: Logger;
};

const replyLink = (appUrl: string, locale: string, token: string, expiresAt: Date) => ({
  replyUrl: `${appUrl}${replyPath(locale, token)}`,
  expiresAt,
});

/** Approbation EXPLICITE du candidat, liée au texte exact. */
export async function approveMessage(
  userId: string,
  contactId: unknown,
  messageId: unknown,
  deps: Pick<SendDeps, "appUrl" | "now">,
): Promise<NegotiationResult> {
  const now = (deps.now ?? (() => new Date()))();
  const contact = await ownedContact(userId, contactId);
  const row = await ownedMessage(userId, contact.id, messageId);
  if (row.status === "SENT" || row.status === "SENDING") return { ok: false, error: "alreadySent" };
  const checked = await preflight(userId, contact, row);
  if (!checked.ok) return checked;

  let prepared: { sentTextEnc: string; cardLinkId: string } | null = null;
  if (contact.channel === "APPLY_URL") {
    if (!deps.appUrl) return { ok: false, error: "sendUnavailable" };
    const created = await createCardLink(userId, { now });
    if (!created.ok) return { ok: false, error: "card" };
    const locale = localeOf(contact);
    const text = negotiationPasteText(
      locale,
      checked.body,
      replyLink(deps.appUrl, locale, created.link.token, created.link.expiresAt),
    );
    prepared = { sentTextEnc: encNegotiation(userId, text), cardLinkId: created.link.id };
  }
  const { count } = await db.negotiationMessage.updateMany({
    where: { id: row.id, userId, status: { in: ["DRAFT", "APPROVED"] }, bodyEnc: row.bodyEnc },
    data: {
      status: "APPROVED",
      approvedHash: messageHash(checked.body),
      approvedAt: now,
      ...(prepared ?? {}),
    },
  });
  if (count === 0) {
    await dropPreparedLink(userId, prepared?.cardLinkId ?? null, now);
    return { ok: false, error: "notApproved" };
  }
  if (prepared) await dropPreparedLink(userId, row.cardLinkId, now);
  return { ok: true };
}

/** Envoi par l'e-mail de la plateforme, à la demande du candidat (quota commun aux contacts). */
export async function sendMessage(
  userId: string,
  contactId: unknown,
  messageId: unknown,
  deps: SendDeps,
): Promise<NegotiationResult> {
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();
  const contact = await ownedContact(userId, contactId);
  const row = await ownedMessage(userId, contact.id, messageId);
  if (row.status === "SENT" || row.status === "SENDING") return { ok: false, error: "alreadySent" };
  if (contact.channel !== "EMAIL" || row.status !== "APPROVED" || !row.approvedHash) {
    return { ok: false, error: "notApproved" };
  }
  const checked = await preflight(userId, contact, row);
  if (!checked.ok) return checked;
  if (messageHash(checked.body) !== row.approvedHash) return { ok: false, error: "notApproved" };
  if (!deps.send || !deps.appUrl) return { ok: false, error: "sendUnavailable" };
  if (!contact.offer.applyEmail) return { ok: false, error: "noChannel" };
  const limit = contactDailyLimit();
  if (limit === 0) return { ok: false, error: "quota" };

  const reserved = await db.negotiationMessage.updateMany({
    where: { id: row.id, userId, status: "APPROVED", approvedHash: row.approvedHash },
    data: { status: "SENDING", sentAt: now },
  });
  if (reserved.count === 0) return { ok: false, error: "notApproved" };
  const release = (data: Prisma.NegotiationMessageUpdateManyMutationInput = {}) =>
    db.negotiationMessage.updateMany({
      where: { id: row.id, userId, status: "SENDING" },
      data: { status: "APPROVED", sentAt: null, ...data },
    });

  if ((await sentInWindow(userId, now)) > limit) {
    await release();
    return { ok: false, error: "quota" };
  }
  const created = await createCardLink(userId, { now });
  if (!created.ok) {
    await release();
    return { ok: false, error: "card" };
  }
  const locale = localeOf(contact);
  const message = negotiationEmail(
    locale,
    { offerTitle: contact.offer.title, body: checked.body },
    replyLink(deps.appUrl, locale, created.link.token, created.link.expiresAt),
  );
  try {
    await deps.send({ to: contact.offer.applyEmail, ...message });
  } catch (error) {
    await db.cardLink.update({ where: { id: created.link.id }, data: { revokedAt: now } });
    await release({ lastError: "sendFailed" });
    log.error("negotiation.send_failed", { error: error instanceof Error ? error.name : "erreur" });
    return { ok: false, error: "sendFailed" };
  }
  await db.negotiationMessage.updateMany({
    where: { id: row.id, userId, status: "SENDING" },
    data: {
      status: "SENT",
      sentAt: now,
      sentTextEnc: encNegotiation(userId, message.text),
      cardLinkId: created.link.id,
      lastError: null,
    },
  });
  await dropPreparedLink(userId, row.cardLinkId, now);
  log.info("negotiation.sent", { kind: row.kind, locale });
  return { ok: true };
}

/** Offre sans adresse : le candidat a transmis lui-même le texte approuvé. */
export async function markTransmitted(
  userId: string,
  contactId: unknown,
  messageId: unknown,
  now = new Date(),
): Promise<NegotiationResult> {
  const contact = await ownedContact(userId, contactId);
  const row = await ownedMessage(userId, contact.id, messageId);
  if (row.status === "SENT") return { ok: false, error: "alreadySent" };
  if (contact.channel !== "APPLY_URL" || row.status !== "APPROVED" || !row.sentTextEnc) {
    return { ok: false, error: "notApproved" };
  }
  const { count } = await db.negotiationMessage.updateMany({
    where: { id: row.id, userId, status: "APPROVED", approvedHash: row.approvedHash },
    data: { status: "SENT", sentAt: now },
  });
  return count === 0 ? { ok: false, error: "notApproved" } : { ok: true };
}
