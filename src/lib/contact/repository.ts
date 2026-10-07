import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ContactChannel } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";
import type { AiClient } from "@/lib/ai/client";
import { NotFoundError } from "@/lib/career/repository";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  cardIdentityTerms,
  createCardLink,
  resolveCardLink,
  shareableCard,
} from "@/lib/card/repository";
import { checkMessage, type ReidentificationIssue } from "@/lib/card/reidentify";
import { publicCard } from "@/lib/card/schema";
import { cardPath, replyPath } from "@/lib/card/tokens";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import type { MailSender } from "@/lib/mail/smtp";
import { loadRails, matchOfferSelect, toMatchOffer } from "@/lib/matching/candidate";
import { checkGuardRails } from "@/lib/matching/filters";
import { getMatch } from "@/lib/matching/repository";
import {
  CONTACT_QUOTA_WINDOW_MS,
  contactDailyLimit,
  MAX_REPLIES_PER_DAY,
  MAX_REPLY_LENGTH,
  remainingContacts,
} from "./config";
import { buildDraft, MAX_BODY, MAX_SUBJECT } from "./draft";
import { contactEmail, pasteText, replyNotificationEmail } from "./email";
import { offerLanguage } from "./language";

/**
 * Prises de contact de l'agent avec une entreprise, uniquement via le canal
 * de candidature publié dans l'offre.
 *
 * Cycle : BROUILLON (rédigé par l'agent, modifiable) → APPROUVÉ (geste
 * explicite du candidat, lié au texte exact) → ENVOYÉ. Rien n'est jamais
 * envoyé automatiquement : seul un contact APPROUVÉ dont le texte n'a pas
 * changé depuis peut partir, et seulement à la demande du candidat.
 *
 * Avant toute approbation et tout envoi : garde-fous durs de l'offre
 * revérifiés, carte validée et sans problème de ré-identification, texte du
 * message contrôlé. Une prise de contact par offre ; quota quotidien.
 *
 * Toutes les requêtes sont filtrées par `userId` : le contact d'un autre
 * candidat est traité comme inexistant. Journal : codes et canal seulement,
 * jamais de texte, d'adresse ni d'identité.
 */

const contentAad = (userId: string) => `user:${userId}:contact`;
const replyAad = (userId: string) => `user:${userId}:contact-reply`;

const enc = (userId: string, text: string) => encrypt(text, { aad: contentAad(userId) });
const dec = (userId: string, text: string) => decrypt(text, { aad: contentAad(userId) });

/** Empreinte du texte approuvé : toute modification invalide l'approbation. */
export function draftHash(subject: string, body: string): string {
  return createHash("sha256").update(`${subject}\0${body}`).digest("base64url");
}

export type ContactError =
  | "noChannel"
  | "guardRail"
  | "card"
  | "notApproved"
  | "alreadySent"
  | "reidentifying"
  | "quota"
  | "sendUnavailable"
  | "sendFailed";

export type ContactResult<T = object> =
  ({ ok: true } & T) | { ok: false; error: ContactError; issues?: ReidentificationIssue[] };

const asId = (id: unknown): string => {
  // Un objet (`{ not: "x" }`) deviendrait un filtre Prisma sur toutes les lignes.
  if (typeof id !== "string" || id.length === 0 || id.length > 64) throw new NotFoundError();
  return id;
};

const offerSelect = {
  ...matchOfferSelect,
  url: true,
  source: true,
  country: true,
  status: true,
  duplicateOfId: true,
  applyEmail: true,
  applyEmailPersonal: true,
  applyUrl: true,
} as const;

/** Canal de l'offre : e-mail de candidature en priorité, sinon page « Postuler ». */
export function channelFor(offer: {
  applyEmail: string | null;
  applyUrl: string | null;
}): ContactChannel | null {
  if (offer.applyEmail) return "EMAIL";
  if (offer.applyUrl) return "APPLY_URL";
  return null;
}

/** L'offre est ouverte, canonique et respecte TOUS les garde-fous actuels du candidat. */
async function offerPassesGuardRails(userId: string, offerId: string): Promise<boolean> {
  const [offer, rails] = await Promise.all([
    db.jobOffer.findUnique({ where: { id: offerId }, select: offerSelect }),
    loadRails(db, userId),
  ]);
  if (!offer || !rails || offer.status !== "OPEN" || offer.duplicateOfId) return false;
  return checkGuardRails(toMatchOffer(offer), rails).pass;
}

async function sentInWindow(userId: string, now: Date) {
  return db.contact.count({
    where: {
      userId,
      channel: "EMAIL",
      status: { in: ["SENT", "SENDING"] },
      sentAt: { gte: new Date(now.getTime() - CONTACT_QUOTA_WINDOW_MS) },
    },
  });
}

export async function getQuota(userId: string, now = new Date()) {
  const limit = contactDailyLimit();
  const sent = await sentInWindow(userId, now);
  return { limit, sent, remaining: remainingContacts(sent, limit) };
}

// --- Brouillon ---------------------------------------------------------------------------

export type DraftDeps = { ai: AiClient | null; logger?: Logger };

/**
 * « Contacter cette entreprise » depuis une opportunité : crée le brouillon
 * (ou renvoie le contact existant pour cette offre). Refusé si l'offre viole
 * un garde-fou, n'a pas de canal de candidature, ou si la carte n'est pas
 * partageable.
 */
export async function startContact(
  userId: string,
  matchId: unknown,
  deps: DraftDeps,
): Promise<ContactResult<{ id: string }>> {
  const log = deps.logger ?? defaultLogger;
  // Correspondance d'un autre candidat, offre fermée ou hors garde-fous : 404.
  const match = await getMatch(userId, asId(matchId));
  if (!match) throw new NotFoundError();
  const existing = await db.contact.findUnique({
    where: { userId_offerId: { userId, offerId: match.offer.id } },
    select: { id: true },
  });
  if (existing) return { ok: true, id: existing.id };

  const offer = await db.jobOffer.findUniqueOrThrow({
    where: { id: match.offer.id },
    select: offerSelect,
  });
  const channel = channelFor(offer);
  if (!channel) return { ok: false, error: "noChannel" };
  const card = await shareableCard(userId);
  if (!card.ok) return { ok: false, error: "card", issues: card.issues };

  const locale = offerLanguage(offer);
  const terms = await cardIdentityTerms(userId);
  const draft = await buildDraft(
    {
      locale,
      offerTitle: offer.title,
      companyName: offer.companyName,
      score: match.score,
      card: publicCard(card.card),
      matchedSkills: match.explanation?.skills ?? [],
    },
    deps.ai,
    terms,
    { onError: (code) => log.warn("contact.draft.fallback", { code }) },
  );
  try {
    const row = await db.contact.create({
      data: {
        userId,
        offerId: offer.id,
        channel,
        locale,
        subjectEnc: enc(userId, draft.subject),
        bodyEnc: enc(userId, draft.body),
        draftSource: draft.source,
      },
      select: { id: true },
    });
    log.info("contact.draft.created", { channel, locale, source: draft.source });
    return { ok: true, id: row.id };
  } catch (error) {
    // Double clic : la contrainte « un contact par offre » a joué.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const row = await db.contact.findUniqueOrThrow({
        where: { userId_offerId: { userId, offerId: offer.id } },
        select: { id: true },
      });
      return { ok: true, id: row.id };
    }
    throw error;
  }
}

export const draftInput = z.object({
  subject: z.string().trim().min(1).max(MAX_SUBJECT),
  body: z.string().trim().min(20).max(MAX_BODY),
});

async function ownedContact(userId: string, id: unknown) {
  const row = await db.contact.findFirst({ where: { id: asId(id), userId } });
  if (!row) throw new NotFoundError();
  return row;
}

/** Retire le lien d'un texte préparé puis modifié : il n'a jamais été transmis. */
async function dropPreparedLink(userId: string, cardLinkId: string | null, now: Date) {
  if (!cardLinkId) return;
  await db.cardLink.updateMany({
    where: { id: cardLinkId, userId, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Modifie le brouillon. Une modification retire l'approbation. */
export async function updateDraft(
  userId: string,
  id: unknown,
  input: unknown,
  now = new Date(),
): Promise<ContactResult | { ok: false; error: "invalid"; fields: string[] }> {
  const row = await ownedContact(userId, id);
  if (row.status === "SENT" || row.status === "SENDING") return { ok: false, error: "alreadySent" };
  const parsed = draftInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fields: parsed.error.issues.map((i) => i.path.join(".")),
    };
  }
  const { count } = await db.contact.updateMany({
    where: { id: row.id, userId, status: { in: ["DRAFT", "APPROVED"] } },
    data: {
      subjectEnc: enc(userId, parsed.data.subject),
      bodyEnc: enc(userId, parsed.data.body),
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

/** Contrôles communs à l'approbation et à l'envoi. */
async function preflight(
  userId: string,
  row: { offerId: string; subjectEnc: string; bodyEnc: string },
): Promise<ContactResult<{ subject: string; body: string }>> {
  if (!(await offerPassesGuardRails(userId, row.offerId))) return { ok: false, error: "guardRail" };
  const card = await shareableCard(userId);
  if (!card.ok) return { ok: false, error: "card", issues: card.issues };
  const subject = dec(userId, row.subjectEnc);
  const body = dec(userId, row.bodyEnc);
  const [terms, offer] = await Promise.all([
    cardIdentityTerms(userId),
    db.jobOffer.findUnique({
      where: { id: row.offerId },
      select: { title: true, companyName: true },
    }),
  ]);
  // L'intitulé de l'offre et le nom de l'entreprise destinataire ne sont pas des données du candidat.
  const context = {
    terms,
    target: { offerTitle: offer?.title ?? "", companyName: offer?.companyName ?? null },
  };
  const issues = [
    ...checkMessage(subject, "subject", context),
    ...checkMessage(body, "body", context),
  ];
  if (issues.length > 0) return { ok: false, error: "reidentifying", issues };
  return { ok: true, subject, body };
}

export type SendDeps = {
  /** Expéditeur SMTP (adresse de la plateforme), `null` si non configuré. */
  send: MailSender | null;
  appUrl: string | null;
  now?: () => Date;
  logger?: Logger;
};

function links(appUrl: string, locale: string, token: string, expiresAt: Date) {
  return {
    cardUrl: `${appUrl}${cardPath(locale, token)}`,
    replyUrl: `${appUrl}${replyPath(locale, token)}`,
    expiresAt,
  };
}

/**
 * Approbation EXPLICITE du candidat, liée au texte exact du brouillon. Pour
 * une offre sans adresse (page « Postuler »), prépare aussi le texte à coller,
 * avec le lien de la carte : c'est le moment du partage.
 */
export async function approveDraft(
  userId: string,
  id: unknown,
  deps: Pick<SendDeps, "appUrl" | "now">,
): Promise<ContactResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await ownedContact(userId, id);
  if (row.status === "SENT" || row.status === "SENDING") return { ok: false, error: "alreadySent" };
  const checked = await preflight(userId, row);
  if (!checked.ok) return checked;
  const hash = draftHash(checked.subject, checked.body);

  let prepared: { sentTextEnc: string; cardLinkId: string } | null = null;
  if (row.channel === "APPLY_URL") {
    if (!deps.appUrl) return { ok: false, error: "sendUnavailable" };
    const created = await createCardLink(userId, { now });
    if (!created.ok) return { ok: false, error: "card", issues: created.issues };
    const locale = isAppLocale(row.locale) ? row.locale : DEFAULT_LOCALE;
    const text = pasteText(
      locale,
      checked.body,
      links(deps.appUrl, locale, created.link.token, created.link.expiresAt),
    );
    prepared = { sentTextEnc: enc(userId, text), cardLinkId: created.link.id };
  }
  const { count } = await db.contact.updateMany({
    where: { id: row.id, userId, status: { in: ["DRAFT", "APPROVED"] }, bodyEnc: row.bodyEnc },
    data: { status: "APPROVED", approvedHash: hash, approvedAt: now, ...(prepared ?? {}) },
  });
  if (count === 0) {
    // Modifié ou envoyé entre-temps : le lien préparé n'est jamais utilisé.
    await dropPreparedLink(userId, prepared?.cardLinkId ?? null, now);
    return { ok: false, error: "notApproved" };
  }
  if (prepared) await dropPreparedLink(userId, row.cardLinkId, now);
  return { ok: true };
}

/**
 * Envoi par l'application (canal e-mail), à la demande du candidat. Refusé
 * sans brouillon APPROUVÉ et inchangé depuis l'approbation.
 */
export async function sendContact(
  userId: string,
  id: unknown,
  deps: SendDeps,
): Promise<ContactResult> {
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();
  const row = await ownedContact(userId, id);
  if (row.status === "SENT" || row.status === "SENDING") return { ok: false, error: "alreadySent" };
  if (row.channel !== "EMAIL" || row.status !== "APPROVED" || !row.approvedHash) {
    return { ok: false, error: "notApproved" };
  }
  const checked = await preflight(userId, row);
  if (!checked.ok) return checked;
  if (draftHash(checked.subject, checked.body) !== row.approvedHash) {
    return { ok: false, error: "notApproved" };
  }
  if (!deps.send || !deps.appUrl) return { ok: false, error: "sendUnavailable" };
  const limit = contactDailyLimit();
  if (limit === 0) return { ok: false, error: "quota" };

  // Réservation : un double clic n'envoie qu'une fois.
  const reserved = await db.contact.updateMany({
    where: { id: row.id, userId, status: "APPROVED", approvedHash: row.approvedHash },
    data: { status: "SENDING", sentAt: now },
  });
  if (reserved.count === 0) return { ok: false, error: "notApproved" };
  const release = (data: Prisma.ContactUpdateManyMutationInput = {}) =>
    db.contact.updateMany({
      where: { id: row.id, userId, status: "SENDING" },
      data: { status: "APPROVED", sentAt: null, ...data },
    });

  // Quota quotidien, réservation comprise.
  if ((await sentInWindow(userId, now)) > limit) {
    await release();
    return { ok: false, error: "quota" };
  }

  const offer = await db.jobOffer.findUnique({
    where: { id: row.offerId },
    select: { applyEmail: true },
  });
  if (!offer?.applyEmail) {
    await release();
    return { ok: false, error: "noChannel" };
  }
  const created = await createCardLink(userId, { now });
  if (!created.ok) {
    await release();
    return { ok: false, error: "card", issues: created.issues };
  }
  const locale = isAppLocale(row.locale) ? row.locale : DEFAULT_LOCALE;
  const message = contactEmail(
    locale,
    { subject: checked.subject, body: checked.body },
    links(deps.appUrl, locale, created.link.token, created.link.expiresAt),
  );
  try {
    await deps.send({ to: offer.applyEmail, ...message });
  } catch (error) {
    await db.cardLink.update({ where: { id: created.link.id }, data: { revokedAt: now } });
    await release({ lastError: "sendFailed" });
    log.error("contact.send_failed", { error: error instanceof Error ? error.name : "erreur" });
    return { ok: false, error: "sendFailed" };
  }
  await db.contact.updateMany({
    where: { id: row.id, userId, status: "SENDING" },
    data: {
      status: "SENT",
      sentAt: now,
      sentTextEnc: enc(userId, message.text),
      cardLinkId: created.link.id,
      lastError: null,
    },
  });
  await dropPreparedLink(userId, row.cardLinkId, now);
  log.info("contact.sent", { channel: "EMAIL", locale });
  return { ok: true };
}

/**
 * Offre sans adresse : le candidat a collé lui-même le texte approuvé sur la
 * page « Postuler ». Consigné dans l'historique, aucune donnée n'est envoyée.
 */
export async function markSubmitted(
  userId: string,
  id: unknown,
  now = new Date(),
): Promise<ContactResult> {
  const row = await ownedContact(userId, id);
  if (row.status === "SENT") return { ok: false, error: "alreadySent" };
  if (row.channel !== "APPLY_URL" || row.status !== "APPROVED" || !row.sentTextEnc) {
    return { ok: false, error: "notApproved" };
  }
  const { count } = await db.contact.updateMany({
    where: { id: row.id, userId, status: "APPROVED", approvedHash: row.approvedHash },
    data: { status: "SENT", sentAt: now },
  });
  if (count === 0) return { ok: false, error: "notApproved" };
  return { ok: true };
}

/** Abandon d'un contact non envoyé (le brouillon est supprimé). */
export async function discardContact(userId: string, id: unknown, now = new Date()) {
  const row = await ownedContact(userId, id);
  if (row.status === "SENT" || row.status === "SENDING") return { ok: false as const };
  await db.contact.deleteMany({
    where: { id: row.id, userId, status: { in: ["DRAFT", "APPROVED"] } },
  });
  await dropPreparedLink(userId, row.cardLinkId, now);
  return { ok: true as const };
}

// --- Lecture ------------------------------------------------------------------------------

export async function listContacts(userId: string) {
  const rows = await db.contact.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      channel: true,
      status: true,
      sentAt: true,
      createdAt: true,
      offer: { select: { title: true, companyName: true } },
      replies: { select: { readAt: true, createdAt: true }, orderBy: { createdAt: "desc" } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    status: r.status,
    sentAt: r.sentAt,
    createdAt: r.createdAt,
    offer: r.offer,
    replies: r.replies.length,
    unread: r.replies.filter((x) => !x.readAt).length,
    lastReplyAt: r.replies[0]?.createdAt ?? null,
  }));
}
export type ContactListItem = Awaited<ReturnType<typeof listContacts>>[number];

/** Un contact du candidat (textes déchiffrés), ou `null`. */
export async function getContact(userId: string, id: unknown) {
  if (typeof id !== "string" || id.length > 64) return null;
  const row = await db.contact.findFirst({
    where: { id, userId },
    include: {
      offer: {
        select: {
          id: true,
          title: true,
          companyName: true,
          url: true,
          applyUrl: true,
          applyEmail: true,
          applyEmailPersonal: true,
          status: true,
          matches: { where: { userId }, select: { id: true } },
        },
      },
      cardLink: { select: { expiresAt: true, revokedAt: true, viewCount: true } },
      replies: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!row) return null;
  const subject = dec(userId, row.subjectEnc);
  const body = dec(userId, row.bodyEnc);
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    locale: isAppLocale(row.locale) ? row.locale : DEFAULT_LOCALE,
    draftSource: row.draftSource,
    subject,
    body,
    // Une approbation ne vaut que pour le texte exact approuvé.
    approved: row.status === "APPROVED" && row.approvedHash === draftHash(subject, body),
    approvedAt: row.approvedAt,
    sentText: row.sentTextEnc ? dec(userId, row.sentTextEnc) : null,
    sentAt: row.sentAt,
    lastError: row.lastError,
    offer: {
      id: row.offer.id,
      title: row.offer.title,
      companyName: row.offer.companyName,
      url: row.offer.url,
      applyUrl: row.offer.applyUrl,
      open: row.offer.status === "OPEN",
      matchId: row.offer.matches[0]?.id ?? null,
      // Une adresse nominative n'est jamais affichée.
      recipient:
        row.channel === "EMAIL" && row.offer.applyEmail && !row.offer.applyEmailPersonal
          ? row.offer.applyEmail
          : null,
    },
    cardLink: row.cardLink,
    replies: row.replies.map((r) => ({
      id: r.id,
      body: decrypt(r.bodyEnc, { aad: replyAad(userId) }),
      createdAt: r.createdAt,
      readAt: r.readAt,
    })),
    handoverRequestedAt: row.handoverRequestedAt,
  };
}
export type ContactView = NonNullable<Awaited<ReturnType<typeof getContact>>>;

/**
 * Section « Contacter cette entreprise » d'une opportunité du candidat :
 * canal publié par l'offre, contact existant, carte validée ou non.
 */
export async function contactOptions(userId: string, matchId: string) {
  const match = await db.match.findFirst({
    where: { id: matchId, userId },
    select: { offer: { select: { id: true, applyEmail: true, applyUrl: true } } },
  });
  if (!match) return null;
  const [contact, card] = await Promise.all([
    db.contact.findUnique({
      where: { userId_offerId: { userId, offerId: match.offer.id } },
      select: { id: true, status: true, channel: true },
    }),
    db.profileCard.findUnique({ where: { userId }, select: { approvedAt: true } }),
  ]);
  return { channel: channelFor(match.offer), contact, cardApproved: Boolean(card?.approvedAt) };
}

export async function markRepliesRead(userId: string, contactId: string, now = new Date()) {
  await db.contactReply.updateMany({
    where: { userId, contactId, readAt: null },
    data: { readAt: now },
  });
}

export async function unreadReplies(userId: string) {
  return db.contactReply.count({ where: { userId, readAt: null } });
}

// --- Réponses des entreprises ----------------------------------------------------------

export const replyInput = z.object({ body: z.string().trim().min(2).max(MAX_REPLY_LENGTH) });

export type ReplyDeps = {
  send: MailSender | null;
  appUrl: string | null;
  now?: () => Date;
  logger?: Logger;
};

/**
 * Page de réponse publique : seul un jeton actif, lié à un contact ENVOYÉ,
 * l'ouvre. Renvoie le titre de l'offre (affiché à l'entreprise) ou `null`.
 */
export async function replyTarget(token: unknown, now = new Date()) {
  const link = await resolveCardLink(token, { now });
  if (!link?.contactId) return null;
  const contact = await db.contact.findFirst({
    where: { id: link.contactId, userId: link.userId, status: "SENT" },
    select: { id: true, userId: true, offer: { select: { title: true } } },
  });
  return contact ? { ...contact, card: link.card } : null;
}

/**
 * Réponse d'une entreprise : enregistrée (chiffrée) dans la boîte du
 * candidat, qui est prévenu par e-mail sans le contenu.
 */
export async function recordReply(
  token: unknown,
  input: unknown,
  deps: ReplyDeps,
): Promise<{ ok: true } | { ok: false; error: "notFound" | "invalid" | "rateLimited" }> {
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();
  const target = await replyTarget(token, now);
  if (!target) return { ok: false, error: "notFound" };
  const parsed = replyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const recent = await db.contactReply.count({
    where: {
      contactId: target.id,
      createdAt: { gte: new Date(now.getTime() - CONTACT_QUOTA_WINDOW_MS) },
    },
  });
  if (recent >= MAX_REPLIES_PER_DAY) return { ok: false, error: "rateLimited" };

  await db.contactReply.create({
    data: {
      userId: target.userId,
      contactId: target.id,
      bodyEnc: encrypt(parsed.data.body, { aad: replyAad(target.userId) }),
      createdAt: now,
    },
  });
  log.info("contact.reply.received", {});

  const user = await db.user.findUnique({
    where: { id: target.userId },
    select: { email: true, locale: true },
  });
  if (user && deps.send && deps.appUrl) {
    const locale: AppLocale = isAppLocale(user.locale) ? user.locale : DEFAULT_LOCALE;
    try {
      await deps.send({
        to: user.email,
        ...replyNotificationEmail(locale, {
          offerTitle: target.offer.title,
          inboxUrl: `${deps.appUrl}/${locale}/app/contacts/${target.id}`,
        }),
      });
    } catch (error) {
      log.error("contact.reply.notify_failed", {
        error: error instanceof Error ? error.name : "erreur",
      });
    }
  }
  return { ok: true };
}
