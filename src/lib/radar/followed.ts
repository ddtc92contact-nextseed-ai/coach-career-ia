import type { PrismaClient } from "@/generated/prisma/client";
import type { AtsType } from "@/generated/prisma/enums";
import { markMatchingDirty } from "@/lib/matching/jobs";
import { detectSectors, isSameCompany } from "@/lib/matching/signals";
import type { CandidateRails } from "@/lib/matching/types";
import { detectAtsBoard, looksLikeUrl, nameFromToken, probeBoard, type AtsBoard } from "./careers";
import type { HttpClient } from "./http";

/**
 * « Mes entreprises à suivre » : un candidat suit des entreprises (job boards
 * ATS publics) que le radar surveille ensuite à chaque passage. Les
 * entreprises sont partagées entre tous les candidats ; le lien
 * candidat ↔ entreprise est une donnée personnelle (il peut révéler une
 * recherche d'emploi) : requêtes toujours filtrées par `userId`, jamais
 * journalisé, jamais montré aux entreprises.
 *
 * Sans `server-only` : testé avec le client Prisma de la base de test.
 */

/** Nombre maximal d'entreprises suivies par candidat. */
export const MAX_FOLLOWED = 50;

export type FollowError =
  | "invalidUrl"
  | "unsupported"
  | "notFound"
  | "unreachable"
  | "limit"
  | "rateLimited"
  | "unknownCompany";

export type FollowResult =
  | { ok: true; companyId: string; name: string; openOffers: number; alreadyFollowed: boolean }
  | { ok: false; error: FollowError };

export type FollowDeps = {
  http: HttpClient;
  /** Limitation des validations (requêtes vers les ATS) ; `false` = refusée. */
  allowProbe?: () => boolean;
};

/** Slug d'une entreprise ajoutée : `ats-jeton`, suffixé en cas de collision. */
async function uniqueSlug(prisma: PrismaClient, board: AtsBoard): Promise<string> {
  const base = `${board.atsType}-${board.boardToken}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  for (let i = 0; ; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await prisma.company.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
}

async function openOffers(prisma: PrismaClient, companyId: string): Promise<number> {
  return prisma.jobOffer.count({ where: { companyId, status: "OPEN", duplicateOfId: null } });
}

/** Entreprise déjà connue pour ce board (jetons comparés sans tenir compte de la casse). */
function findByBoard(prisma: PrismaClient, board: AtsBoard) {
  return prisma.company.findFirst({
    where: {
      atsType: board.atsType,
      boardToken: { equals: board.boardToken, mode: "insensitive" },
    },
    select: { id: true, name: true, active: true, origin: true },
  });
}

async function addFollow(prisma: PrismaClient, userId: string, companyId: string) {
  const existing = await prisma.followedCompany.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { userId: true },
  });
  if (existing) return { alreadyFollowed: true };
  await prisma.followedCompany.create({ data: { userId, companyId } });
  // Les offres de l'entreprise remontent dans le classement : recalcul.
  await markMatchingDirty(prisma, userId);
  return { alreadyFollowed: false };
}

async function underLimit(prisma: PrismaClient, userId: string): Promise<boolean> {
  return (await prisma.followedCompany.count({ where: { userId } })) < MAX_FOLLOWED;
}

/**
 * Suit une entreprise à partir de l'URL de sa page carrières. Un board déjà
 * connu (liste de référence ou ajouté par un autre candidat) est réutilisé
 * sans requête ; sinon il est validé par une requête à son API publique, puis
 * enregistré : il entre dans le prochain passage du radar.
 */
export async function followByUrl(
  prisma: PrismaClient,
  userId: string,
  input: string,
  deps: FollowDeps,
): Promise<FollowResult> {
  if (!looksLikeUrl(input)) return { ok: false, error: "invalidUrl" };
  const board = detectAtsBoard(input);
  if (!board) return { ok: false, error: "unsupported" };

  const known = await findByBoard(prisma, board);
  if (known) {
    const followed = await prisma.followedCompany.findUnique({
      where: { userId_companyId: { userId, companyId: known.id } },
      select: { userId: true },
    });
    if (!followed && !(await underLimit(prisma, userId))) return { ok: false, error: "limit" };
    // Entreprise ajoutée puis délaissée par tous : elle reprend du service.
    if (!known.active && known.origin === "USER") {
      await prisma.company.update({ where: { id: known.id }, data: { active: true } });
    }
    const { alreadyFollowed } = await addFollow(prisma, userId, known.id);
    return {
      ok: true,
      companyId: known.id,
      name: known.name,
      openOffers: await openOffers(prisma, known.id),
      alreadyFollowed,
    };
  }

  if (!(await underLimit(prisma, userId))) return { ok: false, error: "limit" };
  if (deps.allowProbe && !deps.allowProbe()) return { ok: false, error: "rateLimited" };
  const probe = await probeBoard(deps.http, board);
  if (!probe.ok) return { ok: false, error: probe.reason };

  const name = (probe.companyName ?? nameFromToken(board.boardToken)).slice(0, 120);
  let company: { id: string; name: string };
  try {
    company = await prisma.company.create({
      data: {
        slug: await uniqueSlug(prisma, board),
        name,
        atsType: board.atsType,
        boardToken: board.boardToken,
        atsRegion: board.atsRegion,
        origin: "USER",
        active: true,
      },
      select: { id: true, name: true },
    });
  } catch {
    // Ajout simultané du même board par un autre candidat.
    const raced = await findByBoard(prisma, board);
    if (!raced) throw new Error("Entreprise introuvable après création concurrente");
    company = raced;
  }
  const { alreadyFollowed } = await addFollow(prisma, userId, company.id);
  return {
    ok: true,
    companyId: company.id,
    name: company.name,
    openOffers: probe.openOffers,
    alreadyFollowed,
  };
}

/** Suit une entreprise déjà surveillée (résultat d'une recherche par nom). */
export async function followCompany(
  prisma: PrismaClient,
  userId: string,
  companyId: string,
): Promise<FollowResult> {
  if (typeof companyId !== "string" || !companyId) return { ok: false, error: "unknownCompany" };
  const company = await prisma.company.findFirst({
    where: { id: companyId, active: true, atsType: { not: null } },
    select: { id: true, name: true },
  });
  if (!company) return { ok: false, error: "unknownCompany" };
  const already = await prisma.followedCompany.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { userId: true },
  });
  if (!already && !(await underLimit(prisma, userId))) return { ok: false, error: "limit" };
  const { alreadyFollowed } = await addFollow(prisma, userId, company.id);
  return {
    ok: true,
    companyId: company.id,
    name: company.name,
    openOffers: await openOffers(prisma, company.id),
    alreadyFollowed,
  };
}

export async function unfollowCompany(prisma: PrismaClient, userId: string, companyId: string) {
  if (typeof companyId !== "string") return;
  const { count } = await prisma.followedCompany.deleteMany({ where: { userId, companyId } });
  if (count > 0) await markMatchingDirty(prisma, userId);
}

export type CompanySearchResult = {
  id: string;
  name: string;
  sector: string | null;
  atsType: AtsType;
  followed: boolean;
};

/** Recherche par nom parmi les entreprises déjà surveillées par le radar. */
export async function searchCompanies(
  prisma: PrismaClient,
  userId: string,
  query: string,
): Promise<CompanySearchResult[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const rows = await prisma.company.findMany({
    where: {
      active: true,
      atsType: { not: null },
      name: { contains: q, mode: "insensitive" },
    },
    orderBy: { name: "asc" },
    take: 10,
    select: {
      id: true,
      name: true,
      sector: true,
      atsType: true,
      followers: { where: { userId }, select: { userId: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sector: r.sector,
    atsType: r.atsType!,
    followed: r.followers.length > 0,
  }));
}

export type FollowedCompanyView = {
  id: string;
  name: string;
  sector: string | null;
  atsType: AtsType | null;
  followedAt: Date;
  openOffers: number;
  /** `waiting` : pas encore collectée ; `paused` : retirée du radar par l'équipe. */
  status: "ok" | "waiting" | "failing" | "paused";
  lastRunAt: Date | null;
  /** Garde-fou qui l'emporte : ses offres ne seront jamais proposées. */
  excludedBy: "company" | "sector" | null;
};

const SOURCE_BY_ATS: Record<AtsType, string> = {
  GREENHOUSE: "greenhouse",
  LEVER: "lever",
  ASHBY: "ashby",
  SMARTRECRUITERS: "smartrecruiters",
  RECRUITEE: "recruitee",
  WORKABLE: "workable",
};

/** Clé de collecte (`SourceRun.sourceKey`) d'une entreprise. */
export function companySourceKey(company: { atsType: AtsType; slug: string }): string {
  return `${SOURCE_BY_ATS[company.atsType]}:${company.slug}`;
}

/** Entreprises suivies par le candidat, avec offres ouvertes et état de la collecte. */
export async function listFollowedCompanies(
  prisma: PrismaClient,
  userId: string,
  rails: Pick<CandidateRails, "excludedCompanies" | "excludedSectors"> | null,
): Promise<FollowedCompanyView[]> {
  const rows = await prisma.followedCompany.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      company: {
        select: {
          id: true,
          slug: true,
          name: true,
          sector: true,
          atsType: true,
          active: true,
          _count: { select: { offers: { where: { status: "OPEN", duplicateOfId: null } } } },
        },
      },
    },
  });
  const keys = rows
    .filter((r) => r.company.atsType)
    .map((r) => companySourceKey({ atsType: r.company.atsType!, slug: r.company.slug }));
  const runs = keys.length
    ? await prisma.sourceRun.findMany({
        where: { sourceKey: { in: keys }, status: { not: "RUNNING" } },
        orderBy: { startedAt: "desc" },
        distinct: ["sourceKey"],
        select: { sourceKey: true, status: true, startedAt: true },
      })
    : [];
  const lastRun = new Map(runs.map((r) => [r.sourceKey, r]));

  return rows.map(({ createdAt, company }) => {
    const run = company.atsType
      ? lastRun.get(companySourceKey({ atsType: company.atsType, slug: company.slug }))
      : undefined;
    const excludedBy =
      rails && rails.excludedCompanies.some((name) => isSameCompany(company.name, name))
        ? "company"
        : rails && detectSectors(company.sector).some((s) => rails.excludedSectors.includes(s))
          ? "sector"
          : null;
    return {
      id: company.id,
      name: company.name,
      sector: company.sector,
      atsType: company.atsType,
      followedAt: createdAt,
      openOffers: company._count.offers,
      status: !company.active
        ? "paused"
        : !run
          ? "waiting"
          : run.status === "FAILED"
            ? "failing"
            : "ok",
      lastRunAt: run?.startedAt ?? null,
      excludedBy,
    };
  });
}

/** Identifiants des entreprises suivies (classement et pastille « entreprise suivie »). */
export async function followedCompanyIds(
  prisma: PrismaClient,
  userId: string,
): Promise<Set<string>> {
  const rows = await prisma.followedCompany.findMany({
    where: { userId },
    select: { companyId: true },
  });
  return new Set(rows.map((r) => r.companyId));
}

/** Export RGPD : entreprises suivies. */
export async function exportFollowedCompanies(prisma: PrismaClient, userId: string) {
  const rows = await prisma.followedCompany.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      company: { select: { name: true, atsType: true, boardToken: true, website: true } },
    },
  });
  return rows.map((r) => ({
    name: r.company.name,
    ats: r.company.atsType,
    boardToken: r.company.boardToken,
    website: r.company.website,
    followedAt: r.createdAt.toISOString(),
  }));
}
