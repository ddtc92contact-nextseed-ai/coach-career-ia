import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getGuardRails, NotFoundError } from "@/lib/career/repository";
import type { ContractTypeCode, RemotePolicyCode } from "@/lib/career/codes";
import { coachIdentityTerms } from "@/lib/coach/repository";
import { buildCard } from "./build";
import { checkCard, type ReidentificationIssue } from "./reidentify";
import { cardSchema, parseCard, publicCard, type CardContent } from "./schema";
import {
  cardLinkTtlDays,
  hashToken,
  isLinkActive,
  isTokenShape,
  linkExpiry,
  newToken,
} from "./tokens";

/**
 * Carte de profil anonyme et liens publics. Toutes les requêtes sont filtrées
 * par l'utilisateur courant ; un lien d'un autre candidat est traité comme
 * inexistant. Rien de la carte ni des jetons n'est journalisé.
 *
 * Règle de partage : une carte n'est partageable que VALIDÉE par le candidat
 * (`approvedAt`, remis à `null` à chaque modification) ET sans problème de
 * ré-identification au moment du partage (le contrôle est refait à chaque
 * fois : les termes connus ont pu changer depuis la validation).
 */

// --- Termes identifiants connus côté serveur ------------------------------------------

const COMPANY_CACHE_MS = 10 * 60_000;
const MAX_COMPANY_NAMES = 3_000;
let companyCache: { at: number; names: string[] } | null = null;

/**
 * Noms d'entreprises connus du radar (entreprises suivies, employeurs des
 * offres) : un ancien employeur cité dans la carte est très probablement
 * parmi eux. Mis en cache quelques minutes.
 */
async function knownCompanyNames(): Promise<string[]> {
  if (companyCache && Date.now() - companyCache.at < COMPANY_CACHE_MS) return companyCache.names;
  const [companies, offers] = await Promise.all([
    db.company.findMany({ select: { name: true } }),
    db.jobOffer.groupBy({
      by: ["companyName"],
      where: { companyName: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { companyName: "desc" } },
      take: MAX_COMPANY_NAMES,
    }),
  ]);
  const names = new Set<string>();
  for (const name of [...companies.map((c) => c.name), ...offers.map((o) => o.companyName)]) {
    const clean = name
      ?.replace(/\b(?:SAS|SASU|SARL|SA|EURL|GmbH|AG|Inc\.?|Ltd|LLC|BV|SE)$/i, "")
      .trim();
    if (clean && clean.length >= 4) names.add(clean);
  }
  companyCache = { at: Date.now(), names: [...names].sort((a, b) => b.length - a.length) };
  return companyCache.names;
}

/** Termes identifiants vérifiés côté serveur (le coffre, lui, n'est lisible que dans le navigateur). */
export async function cardIdentityTerms(userId: string): Promise<string[]> {
  const [own, companies] = await Promise.all([coachIdentityTerms(userId), knownCompanyNames()]);
  return [...new Set([...own, ...companies])].sort((a, b) => b.length - a.length);
}

export async function checkCardFor(userId: string, card: CardContent) {
  return checkCard(card, { terms: await cardIdentityTerms(userId) });
}

// --- Carte -------------------------------------------------------------------------------

/** Mémoire pseudonymisée → carte générée (non enregistrée). */
export async function generateCard(userId: string, now = new Date()): Promise<CardContent> {
  const [experiences, achievements, rails, knownTerms] = await Promise.all([
    db.experience.findMany({
      where: { userId },
      select: { roleTitle: true, seniority: true, startMonth: true, endMonth: true },
    }),
    db.achievement.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        title: true,
        result: true,
        evidenceLevel: true,
        skills: { select: { skill: { select: { name: true } } } },
        proofs: { where: { userId, kind: "URL" }, select: { url: true } },
      },
    }),
    db.guardRails.findUnique({ where: { userId }, select: { userId: true } }),
    coachIdentityTerms(userId),
  ]);
  const view = rails ? await getGuardRails(userId) : null;
  return buildCard(
    {
      experiences,
      achievements: achievements.map((a) => ({
        title: a.title,
        result: a.result,
        evidenceLevel: a.evidenceLevel,
        skills: a.skills.map((s) => s.skill.name),
        proofUrls: a.proofs.map((p) => p.url).filter((u): u is string => !!u),
      })),
      rails: view
        ? {
            minFixedSalary: view.minFixedSalary,
            remotePolicy:
              view.remotePolicy && view.remotePolicy !== "UNKNOWN"
                ? (view.remotePolicy as RemotePolicyCode)
                : null,
            minRemoteDays: view.minRemoteDays,
            contractTypes: view.contractTypes.filter(
              (c) => c !== "UNKNOWN" && c !== "OTHER",
            ) as ContractTypeCode[],
            locations: view.locations.map((l) => ({ label: l.label, radiusKm: l.radiusKm })),
          }
        : null,
      knownTerms,
    },
    now,
  );
}

export type CardState = {
  card: CardContent;
  /** Carte encore jamais enregistrée : proposition générée depuis la mémoire. */
  generated: boolean;
  approvedAt: Date | null;
  issues: ReidentificationIssue[];
};

export async function getCardState(userId: string): Promise<CardState> {
  const row = await db.profileCard.findUnique({ where: { userId } });
  const stored = row ? parseCard(row.content) : null;
  const card = stored ?? (await generateCard(userId));
  return {
    card,
    generated: !stored,
    approvedAt: stored ? (row?.approvedAt ?? null) : null,
    issues: await checkCardFor(userId, card),
  };
}

async function storeCard(userId: string, card: CardContent) {
  const content = card as unknown as Prisma.InputJsonValue;
  await db.profileCard.upsert({
    where: { userId },
    create: { userId, content, approvedAt: null },
    update: { content, approvedAt: null },
  });
}

export type SaveCardResult =
  { ok: true; issues: ReidentificationIssue[] } | { ok: false; invalid: string[] };

/**
 * Enregistre la carte modifiée par le candidat. Toute modification retire la
 * validation : la carte n'est plus partageable avant d'être revalidée.
 */
export async function saveCard(userId: string, input: unknown): Promise<SaveCardResult> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, invalid: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))] };
  }
  await storeCard(userId, parsed.data);
  return { ok: true, issues: await checkCardFor(userId, parsed.data) };
}

/** Repart de la mémoire de carrière actuelle (les modifications sont perdues). */
export async function regenerateCard(userId: string) {
  await storeCard(userId, await generateCard(userId));
}

export type ShareCheck =
  | { ok: true; card: CardContent }
  | { ok: false; reason: "notApproved" | "issues"; issues: ReidentificationIssue[] };

/** Contrôle fait AVANT CHAQUE PARTAGE : carte validée et sans problème de ré-identification. */
export async function shareableCard(userId: string): Promise<ShareCheck> {
  const row = await db.profileCard.findUnique({ where: { userId } });
  const card = row ? parseCard(row.content) : null;
  if (!row || !card || !row.approvedAt) return { ok: false, reason: "notApproved", issues: [] };
  const issues = await checkCardFor(userId, card);
  if (issues.length > 0) return { ok: false, reason: "issues", issues };
  return { ok: true, card };
}

/** Le candidat valide sa carte : refusé tant qu'un problème de ré-identification subsiste. */
export async function approveCard(
  userId: string,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; issues: ReidentificationIssue[] }> {
  const row = await db.profileCard.findUnique({ where: { userId } });
  const card = row ? parseCard(row.content) : null;
  if (!card) return { ok: false, issues: [{ code: "headlineMissing", path: "headline" }] };
  const issues = await checkCardFor(userId, card);
  if (issues.length > 0) return { ok: false, issues };
  await db.profileCard.update({ where: { userId }, data: { approvedAt: now } });
  return { ok: true };
}

// --- Liens publics ----------------------------------------------------------------------

export type CreatedLink = { id: string; token: string; expiresAt: Date };

/**
 * Crée un lien public vers la carte, après le contrôle de partage. Le jeton
 * en clair n'est renvoyé qu'ici (il n'est pas stocké).
 */
export async function createCardLink(
  userId: string,
  options: { now?: Date; ttlDays?: number } = {},
): Promise<{ ok: true; link: CreatedLink } | Extract<ShareCheck, { ok: false }>> {
  const check = await shareableCard(userId);
  if (!check.ok) return check;
  const now = options.now ?? new Date();
  const { token, tokenHash } = newToken();
  const row = await db.cardLink.create({
    data: {
      userId,
      tokenHash,
      expiresAt: linkExpiry(now, options.ttlDays ?? cardLinkTtlDays()),
      createdAt: now,
    },
    select: { id: true, expiresAt: true },
  });
  return { ok: true, link: { id: row.id, token, expiresAt: row.expiresAt } };
}

export async function listCardLinks(userId: string) {
  return db.cardLink.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      viewCount: true,
      lastViewedAt: true,
      contact: { select: { id: true, offer: { select: { title: true, companyName: true } } } },
    },
  });
}

/** Révoque un lien du candidat (celui d'un autre : `NotFoundError`). */
export async function revokeCardLink(userId: string, id: string, now = new Date()) {
  if (typeof id !== "string") throw new NotFoundError();
  const owned = await db.cardLink.count({ where: { id, userId } });
  if (owned === 0) throw new NotFoundError();
  // Un lien déjà révoqué garde sa première date de révocation.
  await db.cardLink.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export type ResolvedLink = {
  linkId: string;
  userId: string;
  contactId: string | null;
  card: CardContent;
};

/**
 * Lien public → carte affichable, ou `null` (jeton inconnu, expiré, révoqué,
 * carte modifiée depuis sa validation, ou devenue non partageable).
 * `countView` : compte une consultation (page publique uniquement).
 */
export async function resolveCardLink(
  token: unknown,
  options: { now?: Date; countView?: boolean } = {},
): Promise<ResolvedLink | null> {
  if (!isTokenShape(token)) return null;
  const now = options.now ?? new Date();
  const link = await db.cardLink.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      contact: { select: { id: true, status: true } },
      negotiationMessage: { select: { contactId: true, status: true } },
    },
  });
  if (!link || !isLinkActive(link, now)) return null;
  const check = await shareableCard(link.userId);
  if (!check.ok) return null;
  if (options.countView) {
    await db.cardLink.update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: now },
    });
  }
  return {
    linkId: link.id,
    userId: link.userId,
    // Seul un contact réellement envoyé ouvre la page de réponse.
    contactId:
      link.contact?.status === "SENT"
        ? link.contact.id
        : // Lien d'un message de négociation transmis : réponse dans le même fil.
          link.negotiationMessage?.status === "SENT"
          ? link.negotiationMessage.contactId
          : null,
    card: publicCard(check.card),
  };
}
