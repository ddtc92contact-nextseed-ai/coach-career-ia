import "server-only";
import { createTranslator } from "use-intl/core";
import { MESSAGES } from "@/i18n/messages";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";
import { resolveCardLinkById } from "@/lib/card/repository";
import type { CardContent } from "@/lib/card/schema";
import {
  decryptReply,
  decryptSentMessage,
  replyInput,
  storeCompanyReply,
  type ReplyDeps,
} from "@/lib/contact/repository";
import { db } from "@/lib/db";
import { portalHandover, portalHandoverCv, type RevealFile } from "@/lib/handover/repository";
import type { RevealedIdentity } from "@/lib/handover/schema";
import { logger as defaultLogger } from "@/lib/logger";
import { decNegotiation } from "@/lib/negotiation/store";
import { threadStatus, type ThreadStatus } from "./thread";

/**
 * Messagerie de l'espace entreprise : les prises de contact anonymes ENVOYÉES
 * par le canal PORTAL sur les offres de l'organisation.
 *
 * - Chaque requête est filtrée par l'organisation du membre connecté
 *   (`requireEmployer()`) : le fil d'une autre organisation, un brouillon, un
 *   contact par e-mail ou un identifiant inventé sont traités comme
 *   inexistants (`null` → 404).
 * - L'organisation ne voit QUE les personnes qui l'ont contactée, une par
 *   fil, sans recherche, filtre ni classement de candidats : la liste ne
 *   montre que l'intitulé de l'offre, la date et le statut du fil.
 * - La carte suit les règles du lien public (expirée, révoquée, ou carte
 *   modifiée depuis sa validation : plus affichée) ; les champs révélés
 *   suivent la levée d'anonymat (révoquée ou expirée : effacés, plus
 *   affichés).
 * - Les réponses sont enregistrées comme celles de la page à jeton
 *   (`storeCompanyReply`) : `ContactReply`, ou message entrant du fil de
 *   négociation si le candidat a ouvert une négociation. Le fil montre aussi
 *   les messages de négociation ENVOYÉS par le candidat (rédigés par son
 *   agent, approuvés par lui) : un seul échange, quel que soit le modèle.
 * - L'identifiant du candidat ne sort jamais de ce module. Journal :
 *   identifiant d'organisation et codes, jamais de contenu.
 */

const portalWhere = (orgId: string) => ({
  orgId,
  channel: "PORTAL" as const,
  status: "SENT" as const,
});

const isId = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && id.length <= 64;

export type ThreadListItem = {
  id: string;
  offerTitle: string;
  sentAt: Date | null;
  lastActivityAt: Date | null;
  status: ThreadStatus;
};

/** Fils de l'organisation, du plus récent au plus ancien (aucun tri par profil). */
export async function listThreads(orgId: string): Promise<ThreadListItem[]> {
  const rows = await db.contact.findMany({
    where: portalWhere(orgId),
    orderBy: { sentAt: "desc" },
    take: 200,
    select: {
      id: true,
      sentAt: true,
      orgReadAt: true,
      orgClosedAt: true,
      offer: { select: { title: true } },
      replies: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      negotiationMessages: {
        where: { status: "SENT" },
        select: { createdAt: true, sentAt: true, direction: true },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { replies: true } },
    },
  });
  return rows.map((r) => {
    const activity = [
      r.sentAt,
      r.replies[0]?.createdAt,
      ...r.negotiationMessages.map((m) => m.sentAt ?? m.createdAt),
    ].filter((d): d is Date => Boolean(d));
    const incoming = r.negotiationMessages.filter((m) => m.direction === "IN").length;
    return {
      id: r.id,
      offerTitle: r.offer.title,
      sentAt: r.sentAt,
      lastActivityAt: activity.length
        ? new Date(Math.max(...activity.map((d) => d.getTime())))
        : null,
      status: threadStatus({ ...r, replies: r._count.replies + incoming }),
    };
  });
}

/** Fils jamais ouverts par un membre (pastille de la navigation). */
export function countNewThreads(orgId: string): Promise<number> {
  return db.contact.count({ where: { ...portalWhere(orgId), orgReadAt: null } });
}

async function ownedThread(orgId: string, id: unknown) {
  if (!isId(id)) return null;
  return db.contact.findFirst({
    where: { id, ...portalWhere(orgId) },
    select: {
      id: true,
      userId: true,
      locale: true,
      subjectEnc: true,
      bodyEnc: true,
      sentTextEnc: true,
      sentAt: true,
      cardLinkId: true,
      orgReadAt: true,
      orgClosedAt: true,
      offer: { select: { title: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        select: { id: true, bodyEnc: true, createdAt: true, closing: true },
      },
      negotiationMandate: { select: { id: true } },
      // Négociation : seuls les messages échangés (jamais les brouillons du candidat).
      negotiationMessages: {
        where: { status: "SENT" },
        orderBy: { createdAt: "asc" },
        select: { id: true, direction: true, bodyEnc: true, sentAt: true, createdAt: true },
      },
    },
  });
}

export type ThreadEntry = {
  id: string;
  /** `company` : réponse de l'organisation ; `candidate` : message de l'agent du candidat, approuvé par lui. */
  from: "company" | "candidate";
  body: string;
  createdAt: Date;
  closing: boolean;
};

export type ThreadView = {
  id: string;
  offerTitle: string;
  sentAt: Date | null;
  status: ThreadStatus;
  /** Message rédigé par l'agent IA du candidat et approuvé par lui. */
  message: { subject: string; body: string };
  /** Carte anonyme, `null` si son lien a expiré ou a été révoqué (ou carte non partageable). */
  card: CardContent | null;
  /** Échanges après le premier message, dans l'ordre chronologique. */
  replies: ThreadEntry[];
  /** Champs révélés par le candidat à cette organisation, `null` si aucun n'est actif. */
  revealed: { identity: RevealedIdentity; expiresAt: Date; createdAt: Date } | null;
};

/**
 * Un fil de l'organisation, ou `null`. À l'ouverture par un membre
 * (`open`) : fil marqué « lu », consultation de la carte et des champs
 * révélés comptée (comme pour les liens).
 */
export async function getThread(
  orgId: string,
  id: unknown,
  options: { now?: Date; open?: boolean } = {},
): Promise<ThreadView | null> {
  const now = options.now ?? new Date();
  const row = await ownedThread(orgId, id);
  if (!row) return null;
  if (options.open && !row.orgReadAt) {
    await db.contact.updateMany({
      where: { id: row.id, orgId, orgReadAt: null },
      data: { orgReadAt: now },
    });
  }
  const entries: ThreadEntry[] = [
    ...row.replies.map((r) => ({
      id: r.id,
      from: "company" as const,
      body: decryptReply(row.userId, r.bodyEnc),
      createdAt: r.createdAt,
      closing: r.closing,
    })),
    ...row.negotiationMessages.map((m) => ({
      id: m.id,
      from: m.direction === "IN" ? ("company" as const) : ("candidate" as const),
      body: decNegotiation(row.userId, m.bodyEnc),
      createdAt: m.sentAt ?? m.createdAt,
      closing: false,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const view = { now, countView: options.open ?? false };
  const [card, revealed] = await Promise.all([
    row.cardLinkId ? resolveCardLinkById(row.cardLinkId, row.userId, view) : null,
    portalHandover(row.userId, row.id, view),
  ]);
  return {
    id: row.id,
    offerTitle: row.offer.title,
    sentAt: row.sentAt,
    status: threadStatus({
      orgReadAt: row.orgReadAt ?? (options.open ? now : null),
      orgClosedAt: row.orgClosedAt,
      replies: entries.filter((e) => e.from === "company").length,
    }),
    message: decryptSentMessage(row),
    card: card?.card ?? null,
    replies: entries,
    revealed,
  };
}

export type ThreadActionResult =
  { ok: true } | { ok: false; error: "notFound" | "invalid" | "closed" | "rateLimited" };

type Member = { userId: string; orgId: string };

/** Réponse d'un membre dans le fil : une `ContactReply`, le candidat est prévenu sans le contenu. */
export async function replyInThread(
  member: Member,
  id: unknown,
  input: unknown,
  deps: ReplyDeps,
): Promise<ThreadActionResult> {
  const row = await ownedThread(member.orgId, id);
  if (!row) return { ok: false, error: "notFound" };
  if (row.orgClosedAt) return { ok: false, error: "closed" };
  const parsed = replyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const result = await storeCompanyReply(
    {
      contactId: row.id,
      userId: row.userId,
      offerTitle: row.offer.title,
      negotiation: Boolean(row.negotiationMandate),
    },
    parsed.data.body,
    { ...deps, authorId: member.userId },
  );
  if (!result.ok) return result;
  (deps.logger ?? defaultLogger).info("employer.inbox.replied", { orgId: member.orgId });
  return { ok: true };
}

/** Message type de clôture, dans la langue de l'échange (celle de l'offre). */
export function closingMessage(locale: AppLocale, offerTitle: string): string {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: "employer.inbox.closing",
  });
  return t("message", { title: offerTitle });
}

/**
 * Clôture polie du fil par l'organisation : un message type (localisé) est
 * remis au candidat, puis le fil n'accepte plus de réponse.
 */
export async function closeThread(
  member: Member,
  id: unknown,
  deps: ReplyDeps,
): Promise<ThreadActionResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await ownedThread(member.orgId, id);
  if (!row) return { ok: false, error: "notFound" };
  const { count } = await db.contact.updateMany({
    where: { id: row.id, orgId: member.orgId, orgClosedAt: null },
    data: { orgClosedAt: now, orgReadAt: row.orgReadAt ?? now },
  });
  if (count === 0) return { ok: false, error: "closed" };
  const locale = isAppLocale(row.locale) ? row.locale : DEFAULT_LOCALE;
  await storeCompanyReply(
    { contactId: row.id, userId: row.userId, offerTitle: row.offer.title },
    closingMessage(locale, row.offer.title),
    { ...deps, now: () => now, authorId: member.userId, closing: true },
  );
  (deps.logger ?? defaultLogger).info("employer.inbox.closed", { orgId: member.orgId });
  return { ok: true };
}

/** CV révélé dans un fil de l'organisation, ou `null`. */
export async function threadCv(orgId: string, id: unknown): Promise<RevealFile | null> {
  if (!isId(id)) return null;
  const row = await db.contact.findFirst({
    where: { id, ...portalWhere(orgId) },
    select: { id: true, userId: true },
  });
  return row ? portalHandoverCv(row.userId, row.id) : null;
}
