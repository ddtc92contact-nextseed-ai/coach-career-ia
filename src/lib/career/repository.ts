import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";
import { MESSAGES } from "@/i18n/messages";
import { SECTORS, type SectorCode, type VisibilityStatusCode } from "./codes";
import {
  computeCompleteness,
  evidenceLevelFor,
  isProven,
  monthToDate,
  skillKey,
  summarizeSkill,
} from "./derive";
import { checkDocument, MAX_DOCUMENTS_PER_USER, type DocumentMimeType } from "./documents";
import type {
  AchievementInput,
  ExperienceInput,
  GuardRailsInput,
  TextProofInput,
  ValidationError,
} from "./schemas";
import { deleteDocument, deleteUserDocuments, readDocument, saveDocument } from "./storage";
import { exportVault } from "@/lib/vault/repository";

/**
 * Accès aux données de la mémoire de carrière.
 *
 * RÈGLE : chaque fonction reçoit l'identifiant de l'utilisateur courant (issu
 * de `requireUser()`) et TOUTES les requêtes sont filtrées par `userId`. Un
 * élément appartenant à un autre utilisateur est traité comme inexistant
 * (`NotFoundError`, ou `null`) : on ne révèle jamais son existence.
 */

export class NotFoundError extends Error {
  constructor() {
    super("Élément introuvable");
    this.name = "NotFoundError";
  }
}

type Tx = Prisma.TransactionClient;

const excludedCompanyAad = (userId: string) => `user:${userId}:excluded-company`;
const fileNameAad = (userId: string) => `user:${userId}:proof-file-name`;

export function asSector(value: string): SectorCode {
  return (SECTORS as readonly string[]).includes(value) ? (value as SectorCode) : "OTHER";
}

// --- Profil -----------------------------------------------------------------------

export async function getVisibility(userId: string): Promise<VisibilityStatusCode> {
  const profile = await db.careerProfile.findUnique({ where: { userId } });
  return profile?.visibility ?? "INVISIBLE";
}

export async function setVisibility(userId: string, visibility: VisibilityStatusCode) {
  await db.careerProfile.upsert({
    where: { userId },
    create: { userId, visibility },
    update: { visibility },
  });
}

export async function setUserLocale(userId: string, locale: AppLocale) {
  await db.user.update({ where: { id: userId }, data: { locale } });
}

/** Enregistre la langue courante si l'utilisateur n'a encore rien choisi. */
export async function initUserLocale(userId: string, locale: AppLocale) {
  await db.user.updateMany({ where: { id: userId, locale: null }, data: { locale } });
}

export async function getUserLocalePreference(userId: string): Promise<AppLocale | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { locale: true } });
  return isAppLocale(user?.locale) ? user.locale : null;
}

// --- Expériences -------------------------------------------------------------------

function experienceData(input: ExperienceInput) {
  return {
    roleTitle: input.roleTitle,
    startMonth: monthToDate(input.startMonth),
    endMonth: input.endMonth ? monthToDate(input.endMonth) : null,
    seniority: input.seniority,
    contractType: input.contractType,
    sector: input.sector,
    companySize: input.companySize,
    companyStage: input.companyStage,
    responsibilities: input.responsibilities,
  };
}

export function listExperiences(userId: string) {
  return db.experience.findMany({
    where: { userId },
    orderBy: [{ endMonth: { sort: "desc", nulls: "first" } }, { startMonth: "desc" }],
    include: { _count: { select: { achievements: true } } },
  });
}

export function getExperience(userId: string, id: string) {
  return db.experience.findFirst({ where: { id, userId } });
}

export async function createExperience(userId: string, input: ExperienceInput) {
  return db.experience.create({ data: { userId, ...experienceData(input) } });
}

export async function updateExperience(userId: string, id: string, input: ExperienceInput) {
  const { count } = await db.experience.updateMany({
    where: { id, userId },
    data: experienceData(input),
  });
  if (count === 0) throw new NotFoundError();
}

/** Les réalisations liées sont conservées, détachées de l'expérience. */
export async function deleteExperience(userId: string, id: string) {
  const { count } = await db.experience.deleteMany({ where: { id, userId } });
  if (count === 0) throw new NotFoundError();
}

// --- Compétences (création à partir des réalisations) -------------------------------

async function upsertSkills(tx: Tx, userId: string, names: string[]): Promise<string[]> {
  const byKey = new Map<string, string>();
  for (const name of names) {
    const key = skillKey(name);
    if (key && !byKey.has(key)) byKey.set(key, name.trim().replace(/\s+/g, " "));
  }
  const ids: string[] = [];
  for (const [nameKey, name] of byKey) {
    const skill = await tx.skill.upsert({
      where: { userId_nameKey: { userId, nameKey } },
      create: { userId, nameKey, name },
      update: {},
      select: { id: true },
    });
    ids.push(skill.id);
  }
  return ids;
}

// --- Réalisations ---------------------------------------------------------------------

const achievementInclude = {
  experience: { select: { id: true, roleTitle: true, startMonth: true, endMonth: true } },
  proofs: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      url: true,
      referenceText: true,
      fileNameEnc: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
  skills: { select: { skill: { select: { id: true, name: true } } } },
} satisfies Prisma.AchievementInclude;

type AchievementRow = Prisma.AchievementGetPayload<{ include: typeof achievementInclude }>;

function presentAchievement(userId: string, row: AchievementRow) {
  return {
    ...row,
    skills: row.skills.map((s) => s.skill).sort((a, b) => a.name.localeCompare(b.name)),
    proofs: row.proofs.map(({ fileNameEnc, ...proof }) => ({
      ...proof,
      fileName: fileNameEnc ? decrypt(fileNameEnc, { aad: fileNameAad(userId) }) : null,
    })),
  };
}
export type AchievementView = ReturnType<typeof presentAchievement>;

export async function listAchievements(userId: string): Promise<AchievementView[]> {
  const rows = await db.achievement.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: achievementInclude,
  });
  return rows.map((row) => presentAchievement(userId, row));
}

export async function getAchievement(userId: string, id: string): Promise<AchievementView | null> {
  const row = await db.achievement.findFirst({
    where: { id, userId },
    include: achievementInclude,
  });
  return row ? presentAchievement(userId, row) : null;
}

async function assertOwnExperience(tx: Tx, userId: string, experienceId?: string) {
  if (!experienceId) return null;
  const experience = await tx.experience.findFirst({
    where: { id: experienceId, userId },
    select: { id: true },
  });
  if (!experience) throw new NotFoundError();
  return experience.id;
}

export async function createAchievement(userId: string, input: AchievementInput) {
  return db.$transaction(async (tx) => {
    const experienceId = await assertOwnExperience(tx, userId, input.experienceId);
    const skillIds = await upsertSkills(tx, userId, input.skills);
    return tx.achievement.create({
      data: {
        userId,
        experienceId,
        title: input.title,
        context: input.context,
        actions: input.actions,
        result: input.result,
        skills: { create: skillIds.map((skillId) => ({ skillId })) },
      },
      select: { id: true },
    });
  });
}

export async function updateAchievement(userId: string, id: string, input: AchievementInput) {
  await db.$transaction(async (tx) => {
    const existing = await tx.achievement.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError();
    const experienceId = await assertOwnExperience(tx, userId, input.experienceId);
    const skillIds = await upsertSkills(tx, userId, input.skills);
    await tx.achievement.update({
      where: { id },
      data: {
        experienceId,
        title: input.title,
        context: input.context,
        actions: input.actions,
        result: input.result,
        skills: { deleteMany: {}, create: skillIds.map((skillId) => ({ skillId })) },
      },
    });
  });
}

export async function deleteAchievement(userId: string, id: string) {
  const files = await db.$transaction(async (tx) => {
    const proofs = await tx.proof.findMany({
      where: { achievementId: id, userId, storageKey: { not: null } },
      select: { storageKey: true },
    });
    const { count } = await tx.achievement.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundError();
    return proofs.map((p) => p.storageKey!);
  });
  await Promise.all(files.map(deleteDocument));
}

// --- Preuves --------------------------------------------------------------------------

async function refreshEvidence(tx: Tx, achievementId: string) {
  const achievement = await tx.achievement.findUniqueOrThrow({
    where: { id: achievementId },
    select: { evidenceLevel: true, _count: { select: { proofs: true } } },
  });
  const level = evidenceLevelFor(achievement.evidenceLevel, achievement._count.proofs);
  if (level !== achievement.evidenceLevel) {
    await tx.achievement.update({ where: { id: achievementId }, data: { evidenceLevel: level } });
  }
}

async function assertOwnAchievement(tx: Tx, userId: string, achievementId: string) {
  const achievement = await tx.achievement.findFirst({
    where: { id: achievementId, userId },
    select: { id: true },
  });
  if (!achievement) throw new NotFoundError();
}

export async function addTextProof(userId: string, achievementId: string, input: TextProofInput) {
  await db.$transaction(async (tx) => {
    await assertOwnAchievement(tx, userId, achievementId);
    await tx.proof.create({
      data:
        input.kind === "URL"
          ? { userId, achievementId, kind: "URL", url: input.url }
          : { userId, achievementId, kind: "REFERENCE", referenceText: input.referenceText },
    });
    await refreshEvidence(tx, achievementId);
  });
}

export type DocumentUploadResult =
  { ok: true; proofId: string } | { ok: false; error: Extract<ValidationError, `file${string}`> };

/** Vérifie, chiffre et stocke une pièce justificative privée. */
export async function addDocumentProof(
  userId: string,
  achievementId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<DocumentUploadResult> {
  const check = checkDocument(file.bytes);
  if (!check.ok) return check;
  const owned = await db.achievement.count({ where: { id: achievementId, userId } });
  if (owned === 0) throw new NotFoundError();
  const documentCount = await db.proof.count({ where: { userId, kind: "DOCUMENT" } });
  if (documentCount >= MAX_DOCUMENTS_PER_USER) return { ok: false, error: "fileQuota" };

  const storageKey = await saveDocument(userId, file.bytes);
  try {
    const proof = await db.$transaction(async (tx) => {
      await assertOwnAchievement(tx, userId, achievementId);
      const created = await tx.proof.create({
        data: {
          userId,
          achievementId,
          kind: "DOCUMENT",
          storageKey,
          fileNameEnc: encrypt(file.name.slice(0, 200) || "document", {
            aad: fileNameAad(userId),
          }),
          mimeType: check.mimeType,
          sizeBytes: file.bytes.length,
        },
        select: { id: true },
      });
      await refreshEvidence(tx, achievementId);
      return created;
    });
    return { ok: true, proofId: proof.id };
  } catch (error) {
    await deleteDocument(storageKey);
    throw error;
  }
}

export async function deleteProof(userId: string, proofId: string) {
  const storageKey = await db.$transaction(async (tx) => {
    const proof = await tx.proof.findFirst({
      where: { id: proofId, userId },
      select: { achievementId: true, storageKey: true },
    });
    if (!proof) throw new NotFoundError();
    await tx.proof.delete({ where: { id: proofId } });
    await refreshEvidence(tx, proof.achievementId);
    return proof.storageKey;
  });
  if (storageKey) await deleteDocument(storageKey);
}

/** Contenu déchiffré d'une pièce justificative, ou `null` si elle n'appartient pas à l'utilisateur. */
export async function getProofDocument(userId: string, proofId: string) {
  const proof = await db.proof.findFirst({
    where: { id: proofId, userId, kind: "DOCUMENT" },
    select: { storageKey: true, fileNameEnc: true, mimeType: true },
  });
  if (!proof?.storageKey || !proof.mimeType) return null;
  return {
    fileName: proof.fileNameEnc
      ? decrypt(proof.fileNameEnc, { aad: fileNameAad(userId) })
      : "document",
    mimeType: proof.mimeType as DocumentMimeType,
    bytes: await readDocument(proof.storageKey),
  };
}

// --- Compétences ------------------------------------------------------------------------

export async function listSkills(userId: string) {
  const skills = await db.skill.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: {
      achievements: {
        where: { achievement: { userId } },
        select: {
          achievement: {
            select: {
              id: true,
              title: true,
              evidenceLevel: true,
              _count: { select: { proofs: true } },
              experience: { select: { startMonth: true, endMonth: true } },
            },
          },
        },
      },
    },
  });
  return skills
    .map((skill) => {
      const achievements = skill.achievements.map((a) => a.achievement);
      return {
        id: skill.id,
        name: skill.name,
        achievements: achievements.map((a) => ({
          id: a.id,
          title: a.title,
          evidenceLevel: a.evidenceLevel,
          proofCount: a._count.proofs,
        })),
        ...summarizeSkill(achievements),
      };
    })
    .sort((a, b) => b.provenCount - a.provenCount || a.name.localeCompare(b.name));
}
export type SkillView = Awaited<ReturnType<typeof listSkills>>[number];

/** Compétence déclarée sans réalisation : autorisée, affichée comme non prouvée. */
export async function addDeclaredSkill(userId: string, name: string) {
  await db.$transaction((tx) => upsertSkills(tx, userId, [name]));
}

export async function deleteSkill(userId: string, id: string) {
  const { count } = await db.skill.deleteMany({ where: { id, userId } });
  if (count === 0) throw new NotFoundError();
}

// --- Garde-fous --------------------------------------------------------------------------

export async function getGuardRails(userId: string) {
  const [rails, locations] = await Promise.all([
    db.guardRails.findUnique({ where: { userId } }),
    db.guardRailLocation.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    minFixedSalary: rails?.minFixedSalary ?? null,
    targetTotalPackage: rails?.targetTotalPackage ?? null,
    remotePolicy: rails?.remotePolicy ?? null,
    minRemoteDays: rails?.minRemoteDays ?? null,
    contractTypes: rails?.contractTypes ?? [],
    excludedSectors: (rails?.excludedSectors ?? []).map(asSector),
    excludedCompanies: (rails?.excludedCompanies ?? []).map((c) =>
      decrypt(c, { aad: excludedCompanyAad(userId) }),
    ),
    maxWeeklyHours: rails?.maxWeeklyHours ?? null,
    acceptsOnCall: rails?.acceptsOnCall ?? false,
    culturePreferences: rails?.culturePreferences ?? [],
    locations: locations.map((l) => ({ id: l.id, label: l.label, radiusKm: l.radiusKm })),
    updatedAt: rails?.updatedAt ?? null,
  };
}
export type GuardRailsView = Awaited<ReturnType<typeof getGuardRails>>;

export async function saveGuardRails(userId: string, input: GuardRailsInput) {
  const data = {
    minFixedSalary: input.minFixedSalary ?? null,
    targetTotalPackage: input.targetTotalPackage ?? null,
    remotePolicy: input.remotePolicy ?? null,
    minRemoteDays: input.minRemoteDays ?? null,
    contractTypes: input.contractTypes,
    excludedSectors: input.excludedSectors,
    excludedCompanies: input.excludedCompanies.map((c) =>
      encrypt(c, { aad: excludedCompanyAad(userId) }),
    ),
    maxWeeklyHours: input.maxWeeklyHours ?? null,
    acceptsOnCall: input.acceptsOnCall,
    culturePreferences: input.culturePreferences,
  };
  await db.$transaction([
    db.guardRails.upsert({ where: { userId }, create: { userId, ...data }, update: data }),
    db.guardRailLocation.deleteMany({ where: { userId } }),
    db.guardRailLocation.createMany({
      data: input.locations.map((l) => ({ userId, label: l.label, radiusKm: l.radiusKm })),
    }),
  ]);
}

// --- Tableau de bord ------------------------------------------------------------------------

export async function getDashboard(userId: string) {
  const [experienceCount, achievements, skills, rails, locationCount, visibility] =
    await Promise.all([
      db.experience.count({ where: { userId } }),
      db.achievement.findMany({ where: { userId }, select: { evidenceLevel: true } }),
      listSkills(userId),
      db.guardRails.findUnique({ where: { userId } }),
      db.guardRailLocation.count({ where: { userId } }),
      getVisibility(userId),
    ]);
  const completeness = computeCompleteness({
    experienceCount,
    achievements,
    provenSkillCount: skills.filter((s) => s.provenCount > 0).length,
    guardRails: {
      hasSalary: rails?.minFixedSalary != null,
      hasLocationOrRemote: locationCount > 0 || rails?.remotePolicy != null,
      hasContractTypes: (rails?.contractTypes.length ?? 0) > 0,
    },
  });
  return {
    completeness,
    visibility,
    counts: {
      experiences: experienceCount,
      achievements: achievements.length,
      provenAchievements: achievements.filter((a) => isProven(a.evidenceLevel)).length,
      skills: skills.length,
    },
  };
}

// --- Compte : export et suppression (RGPD) ------------------------------------------------

function omitUserId<T extends { userId: string }>(row: T): Omit<T, "userId"> {
  const copy: Partial<T> = { ...row };
  delete copy.userId;
  return copy as Omit<T, "userId">;
}

/** Avertissement du coffre chiffré, dans la langue du compte. */
function exportNotice(locale: string | null): string {
  return MESSAGES[isAppLocale(locale) ? locale : DEFAULT_LOCALE].identity.exportNotice;
}

/**
 * Toutes les données de l'utilisateur, déchiffrées, y compris le contenu des
 * pièces justificatives (base64).
 */
export async function exportUserData(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, locale: true, createdAt: true },
  });
  const [visibility, experiences, achievements, skills, guardRails, documents, identityVault] =
    await Promise.all([
      getVisibility(userId),
      db.experience.findMany({ where: { userId }, orderBy: { startMonth: "asc" } }),
      listAchievements(userId),
      listSkills(userId),
      getGuardRails(userId),
      db.proof.findMany({
        where: { userId, kind: "DOCUMENT" },
        select: { id: true, storageKey: true },
      }),
      exportVault(userId, exportNotice(user.locale)),
    ]);
  const contents = new Map<string, string>();
  for (const doc of documents) {
    if (doc.storageKey) {
      contents.set(doc.id, (await readDocument(doc.storageKey)).toString("base64"));
    }
  }

  return {
    format: "coach-career-ia/export",
    version: 1,
    exportedAt: new Date().toISOString(),
    account: user,
    profile: { visibility },
    experiences: experiences.map((e) => omitUserId(e)),
    achievements: achievements.map((a) => ({
      ...omitUserId(a),
      proofs: a.proofs.map((p) => ({ ...p, contentBase64: contents.get(p.id) ?? null })),
    })),
    skills: skills.map(({ achievements: linked, ...s }) => ({
      ...s,
      achievementIds: linked.map((a) => a.id),
    })),
    guardRails,
    /** Coffre d'identité : exporté chiffré, le serveur ne pouvant pas le lire. */
    identityVault,
  };
}
export type UserExport = Awaited<ReturnType<typeof exportUserData>>;

/**
 * Suppression définitive du compte : toutes les tables (cascade sur
 * `users.id`, sessions comprises) puis tous les fichiers.
 */
export async function deleteAccount(userId: string) {
  await db.user.delete({ where: { id: userId } });
  await deleteUserDocuments(userId);
}
