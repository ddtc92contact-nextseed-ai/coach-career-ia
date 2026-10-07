import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  addDeclaredSkill,
  addTextProof,
  createAchievement,
  getExperience,
  getGuardRails,
  listAchievements,
  listExperiences,
  listSkills,
  NotFoundError,
  saveGuardRails,
  updateExperience,
} from "@/lib/career/repository";
import { dateToMonth } from "@/lib/career/derive";
import {
  experienceInput,
  guardRailsInput,
  toFieldErrors,
  type FieldErrors,
} from "@/lib/career/schemas";
import { emailNameParts, redactSuggestion } from "./redact";
import { COACH_QUOTA_WINDOW_MS } from "./quota";
import {
  COACH_LIMITS,
  SUGGESTION_SCHEMAS,
  type CoachMessageView,
  type CoachModeCode,
  type SuggestionData,
  type SuggestionKind,
  type SuggestionPayload,
  type SuggestionView,
} from "./shared";

/**
 * Données du coach. Comme pour la mémoire de carrière, CHAQUE requête est
 * filtrée par l'utilisateur courant : la conversation d'un autre utilisateur
 * est traitée comme inexistante (`null` / `NotFoundError`).
 *
 * Le texte des messages est chiffré (AAD liée à l'utilisateur). Les
 * suggestions ne touchent JAMAIS la mémoire de carrière avant
 * `acceptSuggestion`.
 */

const messageAad = (userId: string) => `user:${userId}:coach-message`;

// --- Conversations ------------------------------------------------------------------

export function createConversation(userId: string, mode: CoachModeCode) {
  return db.coachConversation.create({ data: { userId, mode }, select: { id: true } });
}

export async function listConversations(userId: string) {
  const rows = await db.coachConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
      suggestions: { where: { status: "PENDING", messageId: { not: null } }, select: { id: true } },
    },
  });
  return rows.map(({ suggestions, _count, ...row }) => ({
    ...row,
    messageCount: _count.messages,
    pendingSuggestions: suggestions.length,
  }));
}
export type ConversationSummary = Awaited<ReturnType<typeof listConversations>>[number];

/** Métadonnées d'une conversation de l'utilisateur, ou `null`. */
export function findConversation(userId: string, id: string) {
  return db.coachConversation.findFirst({
    where: { id, userId },
    select: { id: true, mode: true, createdAt: true },
  });
}

type SuggestionRow = Prisma.CoachSuggestionGetPayload<object>;

function presentSuggestion(row: SuggestionRow, titles: Map<string, string>): SuggestionView {
  const payload = row.payload as unknown as SuggestionPayload;
  const data = payload.data as { experienceId?: string };
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    data: payload.data,
    rationale: payload.rationale ?? "",
    identityRemoved: row.identityRemoved,
    experienceTitle: data.experienceId ? (titles.get(data.experienceId) ?? null) : null,
  } as SuggestionView;
}

async function experienceTitles(userId: string): Promise<Map<string, string>> {
  const rows = await db.experience.findMany({
    where: { userId },
    select: { id: true, roleTitle: true },
  });
  return new Map(rows.map((r) => [r.id, r.roleTitle]));
}

/** Conversation complète (messages déchiffrés et suggestions), ou `null`. */
export async function getConversation(userId: string, id: string) {
  const conversation = await db.coachConversation.findFirst({
    where: { id, userId },
    select: {
      id: true,
      mode: true,
      createdAt: true,
      messages: {
        where: { userId },
        orderBy: { createdAt: "asc" },
        include: { suggestions: { where: { userId }, orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!conversation) return null;
  const titles = await experienceTitles(userId);
  const messages: CoachMessageView[] = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: decrypt(m.contentEnc, { aad: messageAad(userId) }),
    createdAt: m.createdAt.toISOString(),
    suggestions: m.suggestions.map((s) => presentSuggestion(s, titles)),
  }));
  return {
    id: conversation.id,
    mode: conversation.mode,
    createdAt: conversation.createdAt,
    messages,
  };
}

export async function deleteConversation(userId: string, id: string) {
  const { count } = await db.coachConversation.deleteMany({ where: { id, userId } });
  if (count === 0) throw new NotFoundError();
}

// --- Messages -------------------------------------------------------------------------

export async function addMessage(
  userId: string,
  conversationId: string,
  role: "USER" | "ASSISTANT",
  content: string,
) {
  return db.$transaction(async (tx) => {
    const { count } = await tx.coachConversation.updateMany({
      where: { id: conversationId, userId },
      data: { updatedAt: new Date() },
    });
    if (count === 0) throw new NotFoundError();
    return tx.coachMessage.create({
      data: {
        userId,
        conversationId,
        role,
        contentEnc: encrypt(content, { aad: messageAad(userId) }),
      },
      select: { id: true, createdAt: true },
    });
  });
}

/**
 * Enregistre un message du candidat SI le quota le permet. Le décompte et
 * l'insertion se font sous un verrou transactionnel propre à l'utilisateur
 * (`pg_advisory_xact_lock`) : des envois simultanés ne peuvent pas dépasser
 * la limite. Renvoie `null` si la limite est atteinte.
 */
export async function addUserMessageWithinQuota(
  userId: string,
  conversationId: string,
  content: string,
  limit: number,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`coach-quota:${userId}`}))`;
    const sent = await tx.coachMessage.count({
      where: {
        userId,
        role: "USER",
        createdAt: { gt: new Date(now.getTime() - COACH_QUOTA_WINDOW_MS) },
      },
    });
    if (sent >= limit) return null;
    const { count } = await tx.coachConversation.updateMany({
      where: { id: conversationId, userId },
      data: { updatedAt: now },
    });
    if (count === 0) throw new NotFoundError();
    const message = await tx.coachMessage.create({
      data: {
        userId,
        conversationId,
        role: "USER",
        contentEnc: encrypt(content, { aad: messageAad(userId) }),
      },
      select: { id: true, createdAt: true },
    });
    return { message, sent: sent + 1 };
  });
}

/**
 * Réserve le tour de la conversation (opération atomique) : un seul appel au
 * modèle à la fois. `false` si un tour est déjà en cours.
 */
export async function acquireTurn(userId: string, conversationId: string, now = new Date()) {
  const { count } = await db.coachConversation.updateMany({
    where: {
      id: conversationId,
      userId,
      OR: [
        { turnStartedAt: null },
        { turnStartedAt: { lt: new Date(now.getTime() - COACH_LIMITS.turnLockMs) } },
      ],
    },
    data: { turnStartedAt: now },
  });
  return count === 1;
}

export async function releaseTurn(userId: string, conversationId: string) {
  await db.coachConversation.updateMany({
    where: { id: conversationId, userId },
    data: { turnStartedAt: null },
  });
}

/** Décompte une relance du message ; `false` si le plafond est atteint. */
export async function claimRetry(userId: string, messageId: string) {
  const { count } = await db.coachMessage.updateMany({
    where: { id: messageId, userId, role: "USER", retryCount: { lt: COACH_LIMITS.maxRetries } },
    data: { retryCount: { increment: 1 } },
  });
  return count === 1;
}

/** Derniers messages (déchiffrés, dans l'ordre), pour le contexte du modèle. */
export async function loadHistory(userId: string, conversationId: string, limit: number) {
  const rows = await db.coachMessage.findMany({
    where: { userId, conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, role: true, contentEnc: true, createdAt: true },
  });
  return rows.reverse().map((m) => ({
    id: m.id,
    role: m.role,
    content: decrypt(m.contentEnc, { aad: messageAad(userId) }),
    createdAt: m.createdAt,
  }));
}

/** Messages envoyés par l'utilisateur dans la fenêtre du quota. */
export function countRecentUserMessages(userId: string, now = new Date()) {
  return db.coachMessage.count({
    where: {
      userId,
      role: "USER",
      createdAt: { gt: new Date(now.getTime() - COACH_QUOTA_WINDOW_MS) },
    },
  });
}

// --- Contexte pour les outils ------------------------------------------------------------

/**
 * Mémoire de carrière PSEUDONYMISÉE pour le modèle : expériences,
 * réalisations, compétences et garde-fous. Jamais l'adresse e-mail, ni les
 * entreprises exclues (seulement leur nombre), ni les noms de fichiers.
 */
export async function careerMemorySnapshot(userId: string) {
  const [experiences, achievements, skills, rails] = await Promise.all([
    listExperiences(userId),
    listAchievements(userId),
    listSkills(userId),
    getGuardRails(userId),
  ]);
  return {
    experiences: experiences.map((e) => ({
      id: e.id,
      roleTitle: e.roleTitle,
      startMonth: dateToMonth(e.startMonth),
      endMonth: e.endMonth ? dateToMonth(e.endMonth) : null,
      seniority: e.seniority,
      contractType: e.contractType,
      sector: e.sector,
      companySize: e.companySize,
      companyStage: e.companyStage,
      responsibilities: e.responsibilities,
    })),
    achievements: achievements.map((a) => ({
      id: a.id,
      experienceId: a.experience?.id ?? null,
      title: a.title,
      context: a.context,
      actions: a.actions,
      result: a.result,
      evidenceLevel: a.evidenceLevel,
      proofs: a.proofs.map((p) => p.kind),
      skills: a.skills.map((s) => s.name),
    })),
    skills: skills.map((s) => ({ name: s.name, level: s.level, provenBy: s.provenCount })),
    guardRails: {
      minFixedSalary: rails.minFixedSalary,
      targetTotalPackage: rails.targetTotalPackage,
      remotePolicy: rails.remotePolicy,
      minRemoteDays: rails.minRemoteDays,
      contractTypes: rails.contractTypes,
      excludedSectors: rails.excludedSectors,
      excludedCompaniesCount: rails.excludedCompanies.length,
      maxWeeklyHours: rails.maxWeeklyHours,
      acceptsOnCall: rails.acceptsOnCall,
      locations: rails.locations.map((l) => ({ label: l.label, radiusKm: l.radiusKm })),
    },
  };
}

/** Termes identifiants connus du candidat, retirés de toute suggestion. */
export async function coachIdentityTerms(userId: string): Promise<string[]> {
  const [user, rails] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { email: true } }),
    getGuardRails(userId),
  ]);
  return [...(user ? emailNameParts(user.email) : []), ...rails.excludedCompanies];
}

/** Vrai si l'expérience appartient à l'utilisateur. */
export async function ownsExperience(userId: string, experienceId: string) {
  return (await db.experience.count({ where: { id: experienceId, userId } })) > 0;
}

// --- Suggestions ------------------------------------------------------------------------

export async function createSuggestion<K extends SuggestionKind>(
  userId: string,
  conversationId: string,
  kind: K,
  payload: SuggestionPayload<K>,
  identityRemoved: boolean,
): Promise<SuggestionView> {
  const conversation = await findConversation(userId, conversationId);
  if (!conversation) throw new NotFoundError();
  const row = await db.coachSuggestion.create({
    data: {
      userId,
      conversationId,
      kind,
      payload: payload as unknown as Prisma.InputJsonValue,
      identityRemoved,
    },
  });
  return presentSuggestion(row, await experienceTitles(userId));
}

/** Rattache les suggestions d'un tour à la réponse du coach. */
export async function attachSuggestions(userId: string, ids: string[], messageId: string) {
  if (!ids.length) return;
  await db.coachSuggestion.updateMany({
    where: { id: { in: ids }, userId },
    data: { messageId },
  });
}

/** Tour échoué : ses suggestions (encore en attente) sont abandonnées. */
export async function discardSuggestions(userId: string, ids: string[]) {
  if (!ids.length) return;
  await db.coachSuggestion.deleteMany({
    where: { id: { in: ids }, userId, status: "PENDING" },
  });
}

export type DecisionResult =
  { ok: true; suggestion: SuggestionView } | { ok: false; errors: FieldErrors };

export async function rejectSuggestion(userId: string, id: string): Promise<DecisionResult> {
  const { count } = await db.coachSuggestion.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { status: "REJECTED", decidedAt: new Date() },
  });
  if (count === 0) {
    const exists = await db.coachSuggestion.count({ where: { id, userId } });
    if (!exists) throw new NotFoundError();
    return { ok: false, errors: { _form: "invalid" } };
  }
  const row = await db.coachSuggestion.findFirstOrThrow({ where: { id, userId } });
  return { ok: true, suggestion: presentSuggestion(row, await experienceTitles(userId)) };
}

class ApplyError extends Error {
  constructor(readonly errors: FieldErrors) {
    super("Suggestion invalide");
  }
}

/** Écrit une suggestion acceptée dans la mémoire de carrière. */
async function applySuggestion<K extends SuggestionKind>(
  userId: string,
  kind: K,
  data: SuggestionData[K],
) {
  switch (kind) {
    case "ACHIEVEMENT": {
      const d = data as SuggestionData["ACHIEVEMENT"];
      const experienceId =
        d.experienceId && (await ownsExperience(userId, d.experienceId))
          ? d.experienceId
          : undefined;
      const created = await createAchievement(userId, {
        title: d.title,
        context: d.context,
        actions: d.actions,
        result: d.result,
        skills: d.skills,
        experienceId,
      });
      if (d.proofUrl) await addTextProof(userId, created.id, { kind: "URL", url: d.proofUrl });
      return;
    }
    case "EXPERIENCE_UPDATE": {
      const d = data as SuggestionData["EXPERIENCE_UPDATE"];
      const current = await getExperience(userId, d.experienceId);
      if (!current) throw new ApplyError({ _form: "notFound" });
      const parsed = experienceInput.safeParse({
        roleTitle: current.roleTitle,
        startMonth: dateToMonth(current.startMonth),
        endMonth: current.endMonth ? dateToMonth(current.endMonth) : undefined,
        seniority: current.seniority,
        contractType: current.contractType,
        sector: current.sector,
        companySize: current.companySize,
        companyStage: current.companyStage,
        responsibilities: current.responsibilities,
        ...Object.fromEntries(Object.entries(d.changes).filter(([, v]) => v !== undefined)),
      });
      if (!parsed.success) throw new ApplyError(toFieldErrors(parsed.error));
      await updateExperience(userId, d.experienceId, parsed.data);
      return;
    }
    case "SKILL": {
      await addDeclaredSkill(userId, (data as SuggestionData["SKILL"]).name);
      return;
    }
    case "GUARD_RAIL": {
      const d = data as SuggestionData["GUARD_RAIL"];
      const current = await getGuardRails(userId);
      const locations = [...current.locations.map(({ label, radiusKm }) => ({ label, radiusKm }))];
      for (const location of d.locations ?? []) {
        const index = locations.findIndex(
          (l) => l.label.toLowerCase() === location.label.toLowerCase(),
        );
        if (index >= 0) locations[index] = location;
        else locations.push(location);
      }
      const { locations: _ignored, ...changes } = d;
      void _ignored;
      const parsed = guardRailsInput.safeParse({
        minFixedSalary: current.minFixedSalary ?? undefined,
        targetTotalPackage: current.targetTotalPackage ?? undefined,
        remotePolicy: current.remotePolicy ?? undefined,
        minRemoteDays: current.minRemoteDays ?? undefined,
        contractTypes: current.contractTypes.filter((c) => c !== "OTHER" && c !== "UNKNOWN"),
        excludedSectors: current.excludedSectors,
        excludedCompanies: current.excludedCompanies,
        maxWeeklyHours: current.maxWeeklyHours ?? undefined,
        acceptsOnCall: current.acceptsOnCall,
        culturePreferences: current.culturePreferences,
        ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
        locations,
      });
      if (!parsed.success) throw new ApplyError(toFieldErrors(parsed.error));
      await saveGuardRails(userId, parsed.data);
      return;
    }
  }
}

/**
 * Le candidat ACCEPTE une suggestion, éventuellement modifiée (`edited`) :
 * contenu revalidé et pseudonymisé, puis écrit dans la mémoire de carrière.
 * Seul point d'écriture d'une suggestion dans la mémoire.
 */
export async function acceptSuggestion(
  userId: string,
  id: string,
  edited?: unknown,
): Promise<DecisionResult> {
  const row = await db.coachSuggestion.findFirst({ where: { id, userId } });
  if (!row) throw new NotFoundError();
  if (row.status !== "PENDING") return { ok: false, errors: { _form: "invalid" } };
  const original = row.payload as unknown as SuggestionPayload;
  const parsed = SUGGESTION_SCHEMAS[row.kind].safeParse(edited ?? original.data);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const redacted = redactSuggestion(row.kind, parsed.data as SuggestionData[typeof row.kind], {
    knownTerms: await coachIdentityTerms(userId),
  });

  // Réservation : deux clics simultanés n'écrivent qu'une fois.
  const { count } = await db.coachSuggestion.updateMany({
    where: { id, userId, status: "PENDING" },
    data: {
      status: "ACCEPTED",
      decidedAt: new Date(),
      payload: { ...original, data: redacted.data } as unknown as Prisma.InputJsonValue,
      identityRemoved: row.identityRemoved || redacted.changed,
    },
  });
  if (count === 0) return { ok: false, errors: { _form: "invalid" } };

  try {
    await applySuggestion(userId, row.kind, redacted.data);
  } catch (error) {
    await db.coachSuggestion.updateMany({
      where: { id, userId },
      data: {
        status: "PENDING",
        decidedAt: null,
        payload: row.payload as Prisma.InputJsonValue,
        identityRemoved: row.identityRemoved,
      },
    });
    if (error instanceof ApplyError) return { ok: false, errors: error.errors };
    if (error instanceof NotFoundError) return { ok: false, errors: { _form: "notFound" } };
    throw error;
  }
  const updated = await db.coachSuggestion.findFirstOrThrow({ where: { id, userId } });
  return { ok: true, suggestion: presentSuggestion(updated, await experienceTitles(userId)) };
}

// --- Export RGPD ------------------------------------------------------------------------

export async function exportCoachData(userId: string) {
  const conversations = await db.coachConversation.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const result = [];
  for (const { id } of conversations) {
    const conversation = await getConversation(userId, id);
    if (conversation) result.push(conversation);
  }
  return result;
}
