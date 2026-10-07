import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";
import type {
  ContractTypeCode,
  CulturePreferenceCode,
  RemotePolicyCode,
  SectorCode,
} from "@/lib/career/codes";
import { CULTURE_PREFERENCES, SECTORS } from "@/lib/career/codes";
import { isProven } from "@/lib/career/derive";
import { decrypt } from "@/lib/crypto/core";
import type { CandidateProfile, CandidateRails, MatchOffer } from "./types";

/**
 * Lecture du candidat (mémoire de carrière, garde-fous) et des offres pour
 * le matching. Sans `server-only` : utilisé par le worker comme par
 * l'application, avec le client Prisma fourni. Toutes les requêtes sont
 * filtrées par `userId`. Les entreprises exclues sont déchiffrées ici, en
 * mémoire, et ne sont jamais journalisées.
 */

/** Données associées du chiffrement des entreprises exclues (voir `career/repository.ts`). */
export const excludedCompanyAad = (userId: string) => `user:${userId}:excluded-company`;

export type Candidate = {
  locale: AppLocale;
  profile: CandidateProfile;
  rails: CandidateRails;
};

export type CandidateStatus =
  | { eligible: true; candidate: Candidate }
  | { eligible: false; reason: "noMemory" | "noGuardRails" };

const sectorCodes = (values: string[]) =>
  values.filter((v): v is SectorCode => (SECTORS as readonly string[]).includes(v));
const cultureCodes = (values: string[]) =>
  values.filter((v): v is CulturePreferenceCode =>
    (CULTURE_PREFERENCES as readonly string[]).includes(v),
  );

/** Garde-fous du candidat (entreprises exclues déchiffrées), ou `null` s'il n'en a pas. */
export async function loadRails(
  prisma: PrismaClient,
  userId: string,
): Promise<CandidateRails | null> {
  const [rails, locations] = await Promise.all([
    prisma.guardRails.findUnique({ where: { userId } }),
    prisma.guardRailLocation.findMany({
      where: { userId },
      select: { latitude: true, longitude: true, radiusKm: true },
    }),
  ]);
  if (!rails) return null;
  return {
    minFixedSalary: rails.minFixedSalary,
    targetTotalPackage: rails.targetTotalPackage,
    remotePolicy:
      rails.remotePolicy && rails.remotePolicy !== "UNKNOWN"
        ? (rails.remotePolicy as RemotePolicyCode)
        : null,
    minRemoteDays: rails.minRemoteDays,
    contractTypes: rails.contractTypes.filter(
      (c) => c !== "UNKNOWN" && c !== "OTHER",
    ) as ContractTypeCode[],
    excludedSectors: sectorCodes(rails.excludedSectors),
    excludedCompanies: rails.excludedCompanies.map((c) =>
      decrypt(c, { aad: excludedCompanyAad(userId) }),
    ),
    maxWeeklyHours: rails.maxWeeklyHours,
    acceptsOnCall: rails.acceptsOnCall,
    culturePreferences: cultureCodes(rails.culturePreferences),
    locations,
  };
}

/** Mémoire de carrière utile au matching. */
export async function loadProfile(prisma: PrismaClient, userId: string): Promise<CandidateProfile> {
  const [experiences, achievements, skills] = await Promise.all([
    prisma.experience.findMany({
      where: { userId },
      orderBy: [{ endMonth: { sort: "desc", nulls: "first" } }, { startMonth: "desc" }],
      select: { seniority: true },
      take: 1,
    }),
    prisma.achievement.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        context: true,
        actions: true,
        result: true,
        evidenceLevel: true,
        skills: { select: { skill: { select: { name: true } } } },
      },
    }),
    prisma.skill.findMany({
      where: { userId },
      select: {
        name: true,
        achievements: {
          where: { achievement: { userId } },
          select: { achievement: { select: { evidenceLevel: true } } },
        },
      },
    }),
  ]);
  return {
    seniority: experiences[0]?.seniority ?? null,
    achievements: achievements.map((a) => {
      const skillNames = a.skills.map((s) => s.skill.name);
      return {
        id: a.id,
        title: a.title,
        text: [a.title, a.context, a.actions, a.result, skillNames.join(", ")]
          .filter(Boolean)
          .join("\n"),
        evidenceLevel: a.evidenceLevel,
        skills: skillNames,
      };
    }),
    // Prouvée dès qu'une réalisation prouvée l'utilise (cf. `summarizeSkill`).
    skills: skills.map((s) => ({
      name: s.name,
      proven: s.achievements.some((link) => isProven(link.achievement.evidenceLevel)),
    })),
  };
}

export async function loadLocale(prisma: PrismaClient, userId: string): Promise<AppLocale> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
  return isAppLocale(user?.locale) ? user.locale : DEFAULT_LOCALE;
}

/** Candidat prêt pour le matching, ou la raison pour laquelle il ne l'est pas encore. */
export async function loadCandidate(
  prisma: PrismaClient,
  userId: string,
): Promise<CandidateStatus> {
  const [profile, rails, locale] = await Promise.all([
    loadProfile(prisma, userId),
    loadRails(prisma, userId),
    loadLocale(prisma, userId),
  ]);
  if (profile.achievements.length === 0 && profile.skills.length === 0) {
    return { eligible: false, reason: "noMemory" };
  }
  if (!rails) return { eligible: false, reason: "noGuardRails" };
  return { eligible: true, candidate: { locale, profile, rails } };
}

/** Colonnes d'une offre lues par le matching. */
export const matchOfferSelect = {
  id: true,
  title: true,
  description: true,
  companyName: true,
  sector: true,
  seniority: true,
  contractLabel: true,
  latitude: true,
  longitude: true,
  remotePolicy: true,
  contractType: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryPeriod: true,
} as const;

type Decimalish = { toString(): string } | null;

/** Ligne Prisma → offre du matching (montants `Decimal` convertis). */
export function toMatchOffer<
  T extends { salaryMin: Decimalish; salaryMax: Decimalish } & Omit<
    MatchOffer,
    "salaryMin" | "salaryMax"
  >,
>(row: T): MatchOffer {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    companyName: row.companyName,
    sector: row.sector,
    seniority: row.seniority,
    contractLabel: row.contractLabel,
    latitude: row.latitude,
    longitude: row.longitude,
    remotePolicy: row.remotePolicy,
    contractType: row.contractType,
    salaryMin: row.salaryMin === null ? null : Number(row.salaryMin.toString()),
    salaryMax: row.salaryMax === null ? null : Number(row.salaryMax.toString()),
    salaryCurrency: row.salaryCurrency,
    salaryPeriod: row.salaryPeriod,
  };
}
