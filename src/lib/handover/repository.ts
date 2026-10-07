import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { ContactChannel } from "@/generated/prisma/enums";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";
import { shareableCard } from "@/lib/card/repository";
import { publicCard, type CardContent } from "@/lib/card/schema";
import { hashToken, isLinkActive, isTokenShape, linkExpiry, newToken } from "@/lib/card/tokens";
import { NotFoundError } from "@/lib/career/repository";
import { decrypt, decryptBytes, encrypt, encryptBytes } from "@/lib/crypto";
import { db } from "@/lib/db";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import type { MailSender } from "@/lib/mail/smtp";
import { handoverTtlDays, revealedPath } from "./config";
import { handoverEmail } from "./email";
import { purgeExpiredHandovers } from "./purge";
import {
  isAllowedCv,
  revealedFields,
  revealInput,
  safeFileName,
  type HandoverField,
  type RevealedIdentity,
} from "./schema";

/**
 * Levée d'anonymat (handover) : le candidat révèle, pour UN fil de contact,
 * les champs de son identité qu'il a choisis.
 *
 * - Le coffre est déchiffré dans le navigateur ; le serveur ne reçoit que les
 *   champs sélectionnés, à la confirmation, pour ce seul contact.
 * - Stockage chiffré avec la clé de la plateforme (AAD lié au candidat et à
 *   la levée), effacé à la révocation ou à l'expiration (purge du worker).
 * - Lien à jeton (empreinte seule stockée), expirant, révocable, propre à
 *   cette levée : il n'ouvre rien d'autre (ni un autre fil, ni la carte seule).
 * - Toutes les requêtes du candidat sont filtrées par `userId` : le fil d'un
 *   autre candidat est traité comme inexistant (404).
 * - Journal : codes, canal et nombre de champs, jamais de valeur d'identité.
 */

const payloadAad = (userId: string, id: string) => `handover:${userId}:${id}`;
const cvAad = (userId: string, id: string) => `handover:${userId}:${id}:cv`;

export type HandoverError =
  | "notSent"
  | "noReply"
  | "alreadyRevealed"
  | "invalid"
  | "cvInvalid"
  | "sendUnavailable"
  | "sendFailed";

export type RevealFile = { name: string; type: string; bytes: Uint8Array };

export type HandoverDeps = {
  /** Expéditeur SMTP de la plateforme, `null` si non configuré. */
  send: MailSender | null;
  appUrl: string | null;
  now?: () => Date;
  logger?: Logger;
  ttlDays?: number;
};

export type RevealResult =
  | {
      ok: true;
      channel: ContactChannel;
      /** Lien à transmettre soi-même (offre sans adresse), sinon `null` (envoyé par e-mail). */
      url: string | null;
      expiresAt: Date;
    }
  | { ok: false; error: HandoverError };

const asId = (id: unknown): string => {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) throw new NotFoundError();
  return id;
};

async function ownedContact(userId: string, id: unknown) {
  const row = await db.contact.findFirst({
    where: { id: asId(id), userId },
    select: {
      id: true,
      status: true,
      channel: true,
      locale: true,
      revealedAt: true,
      offer: { select: { title: true, applyEmail: true } },
      _count: { select: { replies: true } },
    },
  });
  if (!row) throw new NotFoundError();
  return row;
}

const activeWhere = (now: Date) => ({
  revokedAt: null,
  purgedAt: null,
  expiresAt: { gt: now },
});

/**
 * Le candidat lève son anonymat auprès de l'entreprise d'un contact ENVOYÉ
 * qui a répondu. `payload` : champs choisis (validés ici) ; `cv` : CV
 * d'origine déchiffré dans le navigateur, seulement s'il a été coché.
 */
export async function revealIdentity(
  userId: string,
  contactId: unknown,
  input: { payload: unknown; cv: RevealFile | null },
  deps: HandoverDeps,
): Promise<RevealResult> {
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();
  const contact = await ownedContact(userId, contactId);
  if (contact.status !== "SENT") return { ok: false, error: "notSent" };
  if (contact._count.replies === 0) return { ok: false, error: "noReply" };

  const parsed = revealInput.safeParse(input.payload);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (input.cv && !isAllowedCv({ size: input.cv.bytes.length, type: input.cv.type })) {
    return { ok: false, error: "cvInvalid" };
  }
  const fields = revealedFields(parsed.data, Boolean(input.cv));
  if (fields.length === 0) return { ok: false, error: "invalid" };

  const recipient = contact.channel === "EMAIL" ? contact.offer.applyEmail : null;
  if (!deps.appUrl || (contact.channel === "EMAIL" && (!recipient || !deps.send))) {
    return { ok: false, error: "sendUnavailable" };
  }

  // Une levée expirée mais pas encore purgée ne bloque pas une nouvelle levée.
  await purgeExpiredHandovers(db, { now, where: { contactId: contact.id } });
  const active = await db.handover.count({
    where: { userId, contactId: contact.id, ...activeWhere(now) },
  });
  if (active > 0) return { ok: false, error: "alreadyRevealed" };

  // Intitulé des postes (mémoire pseudonymisée du candidat) joint aux employeurs révélés.
  const { employers, ...rest } = parsed.data;
  const experienceIds = (employers ?? [])
    .map((e) => e.experienceId)
    .filter((id): id is string => Boolean(id));
  const roles = experienceIds.length
    ? new Map(
        (
          await db.experience.findMany({
            where: { userId, id: { in: experienceIds } },
            select: { id: true, roleTitle: true },
          })
        ).map((e) => [e.id, e.roleTitle]),
      )
    : new Map<string, string>();
  const identity: RevealedIdentity = {
    ...rest,
    ...(employers
      ? {
          employers: employers.map((e) => ({
            name: e.name,
            role: (e.experienceId && roles.get(e.experienceId)) || null,
          })),
        }
      : {}),
    ...(input.cv
      ? {
          cv: {
            name: safeFileName(input.cv.name),
            type: input.cv.type,
            size: input.cv.bytes.length,
          },
        }
      : {}),
  };

  const id = randomBytes(16).toString("hex");
  const { token, tokenHash } = newToken();
  const expiresAt = linkExpiry(now, deps.ttlDays ?? handoverTtlDays());
  try {
    await db.$transaction([
      db.handover.create({
        data: {
          id,
          userId,
          contactId: contact.id,
          tokenHash,
          fields,
          payloadEnc: encrypt(JSON.stringify(identity), { aad: payloadAad(userId, id) }),
          cvEnc: input.cv
            ? new Uint8Array(encryptBytes(input.cv.bytes, { aad: cvAad(userId, id) }))
            : null,
          expiresAt,
          createdAt: now,
        },
      }),
      db.handoverEvent.create({
        data: {
          userId,
          contactId: contact.id,
          handoverId: id,
          type: "REVEALED",
          fields,
          createdAt: now,
        },
      }),
      db.contact.updateMany({
        where: { id: contact.id, userId },
        data: { revealedAt: now },
      }),
    ]);
  } catch (error) {
    // Double clic : l'index « une levée active par contact » a joué.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "alreadyRevealed" };
    }
    throw error;
  }

  const locale: AppLocale = isAppLocale(contact.locale) ? contact.locale : DEFAULT_LOCALE;
  const url = `${deps.appUrl}${revealedPath(locale, token)}`;
  if (recipient && deps.send) {
    try {
      await deps.send({
        to: recipient,
        ...handoverEmail(locale, { offerTitle: contact.offer.title, url, expiresAt }),
      });
    } catch (error) {
      // Rien n'a été transmis : la levée est annulée sans laisser de trace d'identité.
      await db.$transaction([
        db.handoverEvent.deleteMany({ where: { handoverId: id, userId } }),
        db.handover.deleteMany({ where: { id, userId } }),
        db.contact.updateMany({
          where: { id: contact.id, userId },
          data: { revealedAt: contact.revealedAt },
        }),
      ]);
      log.error("handover.send_failed", { error: error instanceof Error ? error.name : "erreur" });
      return { ok: false, error: "sendFailed" };
    }
  }
  log.info("handover.revealed", { channel: contact.channel, fields: fields.length, locale });
  return {
    ok: true,
    channel: contact.channel,
    url: contact.channel === "APPLY_URL" ? url : null,
    expiresAt,
  };
}

/**
 * Révocation par le candidat : le lien meurt et l'identité (et le CV)
 * révélés sont effacés immédiatement. `false` s'il n'y avait rien d'actif.
 */
export async function revokeHandover(
  userId: string,
  contactId: unknown,
  options: { now?: Date; logger?: Logger } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const contact = await ownedContact(userId, contactId);
  const rows = await db.handover.findMany({
    where: { userId, contactId: contact.id, revokedAt: null, purgedAt: null },
    select: { id: true, fields: true },
  });
  let revoked = 0;
  for (const row of rows) {
    const done = await db.$transaction(async (tx) => {
      const { count } = await tx.handover.updateMany({
        where: { id: row.id, userId, revokedAt: null, purgedAt: null },
        data: { revokedAt: now, purgedAt: now, payloadEnc: null, cvEnc: null },
      });
      if (count === 0) return false;
      await tx.handoverEvent.create({
        data: {
          userId,
          contactId: contact.id,
          handoverId: row.id,
          type: "REVOKED",
          fields: row.fields,
          createdAt: now,
        },
      });
      return true;
    });
    if (done) revoked += 1;
  }
  if (revoked > 0) (options.logger ?? defaultLogger).info("handover.revoked", {});
  return revoked > 0;
}

// --- Lecture par le candidat --------------------------------------------------------------

/** Levée active et journal d'un fil du candidat (métadonnées seulement). */
export async function getHandoverState(userId: string, contactId: string, now = new Date()) {
  const [active, events] = await Promise.all([
    db.handover.findFirst({
      where: { userId, contactId, ...activeWhere(now) },
      select: {
        fields: true,
        createdAt: true,
        expiresAt: true,
        viewCount: true,
        lastViewedAt: true,
      },
    }),
    db.handoverEvent.findMany({
      where: { userId, contactId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, fields: true, createdAt: true },
    }),
  ]);
  return {
    active: active ? { ...active, fields: active.fields as HandoverField[] } : null,
    events: events.map((e) => ({ ...e, fields: e.fields as HandoverField[] })),
  };
}
export type HandoverState = Awaited<ReturnType<typeof getHandoverState>>;

// --- Lien public ------------------------------------------------------------------------

type ResolvedRow = {
  id: string;
  userId: string;
  contactId: string;
  payloadEnc: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  purgedAt: Date | null;
};

/**
 * Jeton → levée, ou `"unknown"` (jamais émis) / `"gone"` (révoquée ou
 * expirée ; une levée expirée est purgée à la volée).
 */
async function lookup(
  token: unknown,
  now: Date,
): Promise<{ status: "unknown" | "gone" } | { status: "active"; row: ResolvedRow }> {
  if (!isTokenShape(token)) return { status: "unknown" };
  const row = await db.handover.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      contactId: true,
      payloadEnc: true,
      expiresAt: true,
      revokedAt: true,
      purgedAt: true,
    },
  });
  if (!row) return { status: "unknown" };
  if (row.purgedAt || !row.payloadEnc || !isLinkActive(row, now)) {
    if (!row.purgedAt) await purgeExpiredHandovers(db, { now, where: { id: row.id } });
    return { status: "gone" };
  }
  return { status: "active", row };
}

export type RevealedProfile = {
  identity: RevealedIdentity;
  /** Carte anonyme, si elle est toujours validée et partageable. */
  card: CardContent | null;
  offerTitle: string;
  expiresAt: Date;
};

/** Page « profil révélé » : `countView` compte une consultation. */
export async function resolveHandover(
  token: unknown,
  options: { now?: Date; countView?: boolean } = {},
): Promise<{ status: "unknown" | "gone" } | { status: "active"; profile: RevealedProfile }> {
  const now = options.now ?? new Date();
  const found = await lookup(token, now);
  if (found.status !== "active") return found;
  const { row } = found;
  const [contact, card] = await Promise.all([
    db.contact.findFirst({
      where: { id: row.contactId, userId: row.userId },
      select: { offer: { select: { title: true } } },
    }),
    shareableCard(row.userId),
  ]);
  if (!contact) return { status: "gone" };
  if (options.countView) {
    await db.handover.update({
      where: { id: row.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: now },
    });
  }
  const identity = JSON.parse(
    decrypt(row.payloadEnc!, { aad: payloadAad(row.userId, row.id) }),
  ) as RevealedIdentity;
  return {
    status: "active",
    profile: {
      identity,
      card: card.ok ? publicCard(card.card) : null,
      offerTitle: contact.offer.title,
      expiresAt: row.expiresAt,
    },
  };
}

/** CV révélé (déchiffré), si la levée est active et l'a inclus. */
export async function handoverCv(
  token: unknown,
  now = new Date(),
): Promise<{ status: "unknown" | "gone" } | { status: "active"; file: RevealFile | null }> {
  const found = await lookup(token, now);
  if (found.status !== "active") return found;
  const { row } = found;
  const stored = await db.handover.findUnique({ where: { id: row.id }, select: { cvEnc: true } });
  if (!stored?.cvEnc) return { status: "active", file: null };
  const identity = JSON.parse(
    decrypt(row.payloadEnc!, { aad: payloadAad(row.userId, row.id) }),
  ) as RevealedIdentity;
  const bytes = decryptBytes(stored.cvEnc, { aad: cvAad(row.userId, row.id) });
  return {
    status: "active",
    file: {
      name: identity.cv?.name ?? "cv",
      type: identity.cv?.type ?? "application/octet-stream",
      bytes: new Uint8Array(bytes),
    },
  };
}

/** Intitulés des postes de la mémoire (pseudonymisée), pour l'aperçu des employeurs révélés. */
export async function experienceRoles(userId: string): Promise<Record<string, string>> {
  const rows = await db.experience.findMany({
    where: { userId },
    select: { id: true, roleTitle: true },
    take: 200,
  });
  return Object.fromEntries(rows.map((r) => [r.id, r.roleTitle]));
}
