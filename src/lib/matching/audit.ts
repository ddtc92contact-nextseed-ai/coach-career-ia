import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { providerFromEnv } from "@/lib/ai/config";
import { isProven } from "@/lib/career/derive";
import { loadCandidate, matchOfferSelect, toMatchOffer } from "./candidate";
import { matchingConfig, type MatchingConfig } from "./config";
import {
  experienceEmbeddingText,
  memoryEmbeddingText,
  memorySimilarities,
  textHash,
} from "./embeddings";
import { checkGuardRails } from "./filters";
import { prefilteredOfferIds } from "./prefilter";
import {
  byRank,
  calibratedRange,
  evaluateOffer,
  rankOffers,
  RELEVANCE_FULL,
  type Components,
  type OfferResult,
  type SemanticRange,
} from "./score";
import { normalizeText, significantTerms, termPattern, truncate } from "./text";
import type { CandidateProfile, CandidateRails, GapCode, MatchOffer, UnknownCode } from "./types";

/**
 * Audit du classement d'un candidat (issue #78), en LECTURE SEULE : rejoue
 * le score du worker (`rankOffers`, `calibratedRange` tels qu'exportés par
 * `score.ts`) sur les offres et les embeddings déjà en base, sans appel au
 * fournisseur d'IA ni écriture. Une offre pas encore embarquée est notée
 * sans similarité, comme le ferait le worker si son embedding échouait.
 *
 * Le rapport ne contient AUCUNE donnée identifiante du candidat : ni nom, ni
 * contact, ni employeur, ni texte de réalisation ou d'expérience, ni ses
 * termes métier. Seulement des identifiants, des empreintes courtes (début
 * du SHA-256 du texte embarqué) et des nombres. Les intitulés et entreprises
 * des offres sont des données publiques.
 */

export const AUDIT_TOP = 30;
/** Offres lues (avec leur description) par lot, comme le worker. */
const BATCH_SIZE = 500;
/** Caractères de l'empreinte affichée d'un élément de la mémoire. */
const FINGERPRINT_LENGTH = 8;

export type Distribution = {
  count: number;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
  /** Valeurs ≥ 90. */
  atLeast90: number;
};

export type MemoryItemAudit = {
  kind: "achievement" | "experience";
  id: string;
  /** Réalisation prouvée (pièce jointe) ; `null` pour une expérience. */
  proven: boolean | null;
  /** Début de l'empreinte du texte embarqué (jamais le texte). */
  fingerprint: string;
  /** Embedding présent en base pour ce texte et ce modèle. */
  embedded: boolean;
  /** Offres pré-filtrées (et embarquées) comparées à l'élément. */
  offers: number;
  median: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
  /** Plage réellement utilisée par le score (calibrée, ou bornes fixes). */
  range: SemanticRange;
  calibrated: boolean;
};

export type OfferAudit = {
  rank: number;
  offerId: string;
  score: number;
  components: Components;
  /** Part du contexte (séniorité, salaire, culture) comptée : `min(1, pertinence / RELEVANCE_FULL)`. */
  gate: number;
  /** Pertinence lexicale seule (score sans embeddings, composante `skills`). */
  lexicalScore: number;
  /** Appui lexical : au moins une compétence ou un intitulé du candidat trouvé dans l'offre. */
  lexical: boolean;
  /** Une exigence de l'offre est citée (réalisation ou expérience). */
  requirement: boolean;
  /** L'offre contient au moins un terme métier du candidat. */
  businessTerm: boolean;
  followed: boolean;
  unknowns: UnknownCode[];
  gaps: GapCode[];
  title: string;
  company: string | null;
};

export type AuditReport = {
  version: 1;
  generatedAt: string;
  userId: string;
  eligible: boolean;
  /** Raison de l'inéligibilité (pas de mémoire ou de garde-fous). */
  reason: "noMemory" | "noGuardRails" | null;
  profile: {
    seniority: string | null;
    achievements: number;
    provenAchievements: number;
    experiences: number;
    skills: number;
    provenSkills: number;
    /** Nombre de termes métier distincts (les termes eux-mêmes ne sont jamais affichés). */
    businessTerms: number;
  } | null;
  settings: {
    /** Modèle d'embeddings lu ; `null` : aucune similarité (score lexical). */
    model: string | null;
    fallback: SemanticRange;
    calibrationMinSamples: number;
    minScore: number;
    maxPerUser: number;
  };
  offers: {
    /** Offres ouvertes et canoniques. */
    open: number;
    prefiltered: number;
    /** Offres qui respectent tous les garde-fous (notées). */
    passing: number;
    /** Offres notées sans embedding (pas encore embarquées, ou refusées). */
    withoutEmbedding: number;
    /** Offres que le worker garderait (score ≥ minScore, au plus maxPerUser). */
    retained: number;
  };
  memory: MemoryItemAudit[];
  scores: { total: Distribution; skills: Distribution };
  /** Correspondances enregistrées par le dernier passage du worker. */
  stored: { total: Distribution; computedAt: string | null };
  top: OfferAudit[];
  /** Part (0 à 1) du top qui contient au moins un terme métier du candidat. */
  topBusinessTermShare: number | null;
};

export class CandidateNotFound extends Error {
  constructor() {
    super("Candidat introuvable");
  }
}

// --- Fonctions pures (aussi utilisées par le banc de profils) ---

const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Quantile interpolé (comme `percentile_cont`) d'une liste triée. */
function quantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const x = p * (sorted.length - 1);
  const i = Math.floor(x);
  const j = Math.min(i + 1, sorted.length - 1);
  return sorted[i]! + (sorted[j]! - sorted[i]!) * (x - i);
}

export function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const q = quantile(sorted, p);
    return q === null ? null : round(q, 1);
  };
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    q1: at(0.25),
    median: at(0.5),
    q3: at(0.75),
    max: sorted.at(-1) ?? null,
    atLeast90: sorted.filter((v) => v >= 90).length,
  };
}

/**
 * Termes métier du candidat : termes significatifs non génériques de ses
 * compétences et des intitulés de ses expériences (« audiovisuel », « régie »,
 * pas « technicien »). Un intitulé fait seulement de termes génériques
 * (« Management ») les garde : ils disent alors le métier.
 */
export function businessTerms(profile: CandidateProfile): string[] {
  const labels = [
    ...profile.skills.map((s) => s.name),
    ...(profile.experiences ?? []).map((e) => e.title),
  ];
  const terms = new Set<string>();
  for (const label of labels) {
    const parsed = significantTerms(label);
    const specific = parsed.filter((t) => t.weight >= 1);
    for (const t of specific.length > 0 ? specific : parsed) terms.add(t.term);
  }
  return [...terms];
}

export function hasBusinessTerm(
  offer: Pick<MatchOffer, "title" | "description">,
  terms: readonly string[],
): boolean {
  const text = normalizeText(`${offer.title}\n${offer.description}`);
  return terms.some((term) => termPattern(term).test(text));
}

/** Lecture d'une offre notée : gate, appui lexical, exigence citée, terme métier. */
export function describeOffer(
  profile: CandidateProfile,
  rails: CandidateRails,
  offer: MatchOffer,
  result: Extract<OfferResult, { pass: true }>,
  terms: readonly string[],
): Omit<OfferAudit, "rank"> {
  const lexicalOnly = evaluateOffer(profile, rails, offer, null);
  const lexicalScore = lexicalOnly.pass ? lexicalOnly.components.skills : 0;
  return {
    offerId: result.offerId,
    score: result.score,
    components: result.components,
    gate: round(Math.min(1, result.components.skills / 100 / RELEVANCE_FULL), 2),
    lexicalScore,
    lexical: lexicalScore > 0,
    requirement:
      result.matches.some((m) => m.requirement !== null) ||
      result.experiences.some((e) => e.requirement !== null),
    businessTerm: hasBusinessTerm(offer, terms),
    followed: result.followed === true,
    unknowns: result.unknowns,
    gaps: result.gaps.map((g) => g.code),
    title: truncate(offer.title, 120),
    company: offer.companyName ? truncate(offer.companyName, 80) : null,
  };
}

// --- Lecture en base ---

type ItemStats = { count: number; median: number; p90: number; p99: number; max: number };

/**
 * Distribution des similarités de chaque élément de la mémoire sur les
 * offres pré-filtrées : mêmes offres et même `percentile_cont` que
 * `memorySimilarityStats` (worker), plus le p90 et le max.
 */
async function itemStats(
  prisma: PrismaClient,
  userId: string,
  model: string,
  offerIds: string[],
): Promise<Map<string, ItemStats>> {
  const result = new Map<string, ItemStats>();
  if (offerIds.length === 0) return result;
  const rows = await prisma.$queryRaw<
    { textHash: string; count: number; median: number; p90: number; p99: number; max: number }[]
  >`
    SELECT s.text_hash AS "textHash", count(*)::int AS count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.similarity) AS median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY s.similarity) AS p90,
           percentile_cont(0.99) WITHIN GROUP (ORDER BY s.similarity) AS p99,
           max(s.similarity) AS max
    FROM (
      SELECT me.text_hash, (1 - (oe.embedding <=> me.embedding))::float8 AS similarity
      FROM offer_embeddings oe
      JOIN memory_embeddings me ON me.user_id = ${userId} AND me.model = oe.model
      WHERE oe.model = ${model} AND oe.offer_id = ANY(${offerIds}::text[])
    ) s
    GROUP BY s.text_hash`;
  for (const row of rows) {
    result.set(row.textHash, {
      count: Number(row.count),
      median: Number(row.median),
      p90: Number(row.p90),
      p99: Number(row.p99),
      max: Number(row.max),
    });
  }
  return result;
}

/**
 * Modèle d'embeddings à lire : celui demandé, sinon celui des embeddings de
 * la mémoire du candidat (le worker supprime ceux des anciens modèles),
 * sinon celui du fournisseur configuré (aucun appel réseau).
 */
async function embeddingModel(
  prisma: PrismaClient,
  userId: string,
  requested: string | undefined,
  env: Record<string, string | undefined>,
): Promise<string | null> {
  if (requested) return requested;
  const models = await prisma.memoryEmbedding.findMany({
    where: { userId },
    distinct: ["model"],
    select: { model: true },
  });
  const configured = (() => {
    try {
      return providerFromEnv(env)?.embeddingModel ?? null;
    } catch {
      return null;
    }
  })();
  if (models.length === 1) return models[0]!.model;
  if (configured && models.some((m) => m.model === configured)) return configured;
  return models[0]?.model ?? null;
}

export type AuditOptions = {
  /** Modèle d'embeddings (défaut : celui de la mémoire du candidat). */
  model?: string;
  top?: number;
  env?: Record<string, string | undefined>;
  now?: () => Date;
};

/**
 * Identifiant du candidat : son id, ou son e-mail (jamais repris dans le
 * rapport).
 */
async function resolveUser(prisma: PrismaClient, identifier: string): Promise<string> {
  const value = identifier.trim();
  const user = value.includes("@")
    ? await prisma.user.findFirst({
        where: { email: { equals: value, mode: "insensitive" } },
        select: { id: true },
      })
    : await prisma.user.findUnique({ where: { id: value }, select: { id: true } });
  if (!user) throw new CandidateNotFound();
  return user.id;
}

/**
 * Audit d'un candidat. `prisma` DOIT être en lecture seule : voir
 * `runReadOnlyAudit` et `readOnlyClient`.
 */
export async function auditCandidate(
  prisma: PrismaClient,
  identifier: string,
  options: AuditOptions = {},
): Promise<AuditReport> {
  const env = options.env ?? process.env;
  const config: MatchingConfig = matchingConfig(env);
  const topSize = options.top ?? AUDIT_TOP;
  const userId = await resolveUser(prisma, identifier);
  const [status, open, stored, state] = await Promise.all([
    loadCandidate(prisma, userId),
    prisma.jobOffer.count({ where: { status: "OPEN", duplicateOfId: null } }),
    prisma.match.findMany({
      where: { userId, status: { in: ["NEW", "SEEN", "SAVED"] } },
      select: { score: true },
    }),
    prisma.matchingState.findUnique({ where: { userId }, select: { computedAt: true } }),
  ]);
  const settings = {
    model: null as string | null,
    fallback: config.semanticRange,
    calibrationMinSamples: config.calibrationMinSamples,
    minScore: config.minScore,
    maxPerUser: config.maxPerUser,
  };
  const base = {
    version: 1 as const,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    userId,
  };
  const storedSummary = {
    total: distribution(stored.map((m) => m.score)),
    computedAt: state?.computedAt?.toISOString() ?? null,
  };
  if (!status.eligible) {
    return {
      ...base,
      eligible: false,
      reason: status.reason,
      profile: null,
      settings,
      offers: { open, prefiltered: 0, passing: 0, withoutEmbedding: 0, retained: 0 },
      memory: [],
      scores: { total: distribution([]), skills: distribution([]) },
      stored: storedSummary,
      top: [],
      topBusinessTermShare: null,
    };
  }

  const { profile, rails } = status.candidate;
  const terms = businessTerms(profile);
  const memory = [
    ...profile.achievements.map((a) => ({
      kind: "achievement" as const,
      id: a.id,
      proven: isProven(a.evidenceLevel),
      hash: textHash(memoryEmbeddingText(a.text)),
    })),
    ...(profile.experiences ?? []).map((e) => ({
      kind: "experience" as const,
      id: e.id,
      proven: null,
      hash: textHash(memoryEmbeddingText(experienceEmbeddingText(e))),
    })),
  ];
  const [ids, followedRows, model] = await Promise.all([
    prefilteredOfferIds(prisma, rails),
    prisma.followedCompany.findMany({ where: { userId }, select: { companyId: true } }),
    embeddingModel(prisma, userId, options.model, env),
  ]);
  settings.model = model;
  const followed = new Set(followedRows.map((f) => f.companyId));

  // --- Mémoire : distribution et plage calibrée de chaque élément ---
  const embeddedHashes = model
    ? new Set(
        (
          await prisma.memoryEmbedding.findMany({
            where: { userId, model },
            select: { textHash: true },
          })
        ).map((e) => e.textHash),
      )
    : new Set<string>();
  const stats = model ? await itemStats(prisma, userId, model, ids) : new Map<string, ItemStats>();
  const items = new Map<string, SemanticRange>();
  const memoryAudit: MemoryItemAudit[] = memory.map((m) => {
    const s = stats.get(m.hash);
    const range = calibratedRange(s, config.semanticRange, config.calibrationMinSamples);
    items.set(m.id, range);
    return {
      kind: m.kind,
      id: m.id,
      proven: m.proven,
      fingerprint: m.hash.slice(0, FINGERPRINT_LENGTH),
      embedded: embeddedHashes.has(m.hash),
      offers: s?.count ?? 0,
      median: s ? round(s.median) : null,
      p90: s ? round(s.p90) : null,
      p99: s ? round(s.p99) : null,
      max: s ? round(s.max) : null,
      range: { ...range },
      calibrated: range !== config.semanticRange,
    };
  });
  const scale = { fallback: config.semanticRange, items };
  // Sans embedding de la mémoire : score lexical seul, comme le worker sans IA.
  const semanticModel = model !== null && embeddedHashes.size > 0 ? model : null;

  // --- Parcours par lots, comme le worker : scores et top ---
  const totals: number[] = [];
  const skills: number[] = [];
  let passing = 0;
  let withoutEmbedding = 0;
  let top: Omit<OfferAudit, "rank">[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const rows = await prisma.jobOffer.findMany({
      where: { id: { in: ids.slice(i, i + BATCH_SIZE) } },
      select: matchOfferSelect,
    });
    const offers = rows.map(toMatchOffer).filter((o) => checkGuardRails(o, rails).pass);
    if (offers.length === 0) continue;
    passing += offers.length;
    let similarities: Map<string, Map<string, number>> | null = null;
    if (semanticModel) {
      const byHash = await memorySimilarities(
        prisma,
        userId,
        semanticModel,
        offers.map((o) => o.id),
      );
      similarities = new Map(
        offers.map((offer) => {
          const sims = byHash.get(offer.id);
          if (!sims) withoutEmbedding++;
          const byItem = new Map<string, number>();
          for (const m of memory) {
            const sim = sims?.get(m.hash);
            if (sim !== undefined) byItem.set(m.id, sim);
          }
          return [offer.id, byItem];
        }),
      );
    } else withoutEmbedding += offers.length;

    const { matches } = rankOffers(profile, rails, offers, similarities, scale, followed);
    for (const m of matches) {
      totals.push(m.score);
      skills.push(m.components.skills);
    }
    const byId = new Map(offers.map((o) => [o.id, o]));
    top = [
      ...top,
      ...matches
        .slice(0, topSize)
        .map((m) => describeOffer(profile, rails, byId.get(m.offerId)!, m, terms)),
    ]
      .sort(byRank)
      .slice(0, topSize);
  }

  const sortedTotals = [...totals].sort((a, b) => b - a);
  const retained = Math.min(
    config.maxPerUser,
    sortedTotals.filter((s) => s >= config.minScore).length,
  );
  return {
    ...base,
    eligible: true,
    reason: null,
    profile: {
      seniority: profile.seniority,
      achievements: profile.achievements.length,
      provenAchievements: memory.filter((m) => m.proven === true).length,
      experiences: profile.experiences?.length ?? 0,
      skills: profile.skills.length,
      provenSkills: profile.skills.filter((s) => s.proven).length,
      businessTerms: terms.length,
    },
    settings,
    offers: { open, prefiltered: ids.length, passing, withoutEmbedding, retained },
    memory: memoryAudit,
    scores: { total: distribution(totals), skills: distribution(skills) },
    stored: storedSummary,
    top: top.map((o, k) => ({ rank: k + 1, ...o })),
    topBusinessTermShare:
      top.length > 0 ? round(top.filter((o) => o.businessTerm).length / top.length, 2) : null,
  };
}

/**
 * Client en LECTURE SEULE : chaque connexion ouvre sa session avec
 * `default_transaction_read_only=on`, donc toute transaction (implicite ou
 * non) est `READ ONLY` et PostgreSQL refuse la moindre écriture.
 */
export function readOnlyClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: "-c default_transaction_read_only=on" }),
  });
}

/** Vérifie que la session est bien en lecture seule (sinon : erreur, rien n'est lu). */
export async function assertReadOnly(prisma: PrismaClient): Promise<void> {
  const [row] = await prisma.$queryRaw<{ readOnly: string }[]>`
    SELECT current_setting('transaction_read_only') AS "readOnly"`;
  if (row?.readOnly !== "on") throw new Error("La session d'audit n'est pas en lecture seule.");
}

/** Audit sur une connexion en lecture seule, ouverte puis fermée ici. */
export async function runReadOnlyAudit(
  connectionString: string,
  identifier: string,
  options: AuditOptions = {},
): Promise<AuditReport> {
  const prisma = readOnlyClient(connectionString);
  try {
    await assertReadOnly(prisma);
    return await auditCandidate(prisma, identifier, options);
  } finally {
    await prisma.$disconnect();
  }
}

// --- Sortie texte ---

const fmt = (x: number | null, digits = 3) => (x === null ? "—" : x.toFixed(digits));
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);
const pad = (value: string | number, width: number) => String(value).padEnd(width).slice(0, width);
const padStart = (value: string | number, width: number) => String(value).padStart(width);
const yesNo = (value: boolean) => (value ? "oui" : "non");

function distributionLine(label: string, d: Distribution): string {
  return `  ${pad(label, 8)} n=${d.count}  min ${d.min ?? "—"}  q1 ${d.q1 ?? "—"}  médiane ${d.median ?? "—"}  q3 ${d.q3 ?? "—"}  max ${d.max ?? "—"}  ≥90 : ${d.atLeast90}`;
}

export function formatAudit(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`Audit du matching — candidat ${report.userId} — ${report.generatedAt}`);
  if (!report.eligible) {
    lines.push(`Candidat non éligible : ${report.reason}. Aucune offre notée.`);
    lines.push(`Correspondances enregistrées : ${report.stored.total.count}.`);
    return `${lines.join("\n")}\n`;
  }
  const p = report.profile!;
  const s = report.settings;
  lines.push(
    `Profil : séniorité ${p.seniority ?? "—"}, ${p.achievements} réalisation(s) dont ${p.provenAchievements} prouvée(s), ${p.experiences} expérience(s), ${p.skills} compétence(s) dont ${p.provenSkills} prouvée(s), ${p.businessTerms} terme(s) métier.`,
  );
  lines.push(
    `Réglages : modèle ${s.model ?? "aucun (score lexical)"}, bornes de repli ${s.fallback.floor}–${s.fallback.ceil}, calibration dès ${s.calibrationMinSamples} offres, seuil ${s.minScore}, ${s.maxPerUser} max.`,
  );
  const o = report.offers;
  lines.push(
    `Offres : ${o.open} ouvertes, ${o.prefiltered} pré-filtrées, ${o.passing} dans les garde-fous, ${o.withoutEmbedding} sans embedding, ${o.retained} retenues par le worker.`,
  );

  lines.push("", "Mémoire (similarité cosinus offre ↔ élément) :");
  lines.push(
    `  ${pad("élément", 12)} ${pad("empreinte", 9)} ${pad("emb.", 4)} ${padStart("offres", 6)} ${padStart("médiane", 7)} ${padStart("p90", 6)} ${padStart("p99", 6)} ${padStart("max", 6)}  plage utilisée`,
  );
  for (const m of report.memory) {
    const kind = m.kind === "experience" ? "expérience" : m.proven ? "réal. prouv." : "réal. décl.";
    lines.push(
      `  ${pad(kind, 12)} ${pad(m.fingerprint, 9)} ${pad(yesNo(m.embedded), 4)} ${padStart(m.offers, 6)} ${padStart(fmt(m.median), 7)} ${padStart(fmt(m.p90), 6)} ${padStart(fmt(m.p99), 6)} ${padStart(fmt(m.max), 6)}  ${fmt(m.range.floor)}–${fmt(m.range.ceil)} ${m.calibrated ? "(calibrée)" : "(repli)"}`,
    );
  }
  if (report.memory.length === 0) lines.push("  (aucun élément embarquable)");

  lines.push("", "Distribution des scores (offres dans les garde-fous) :");
  lines.push(distributionLine("total", report.scores.total));
  lines.push(distributionLine("skills", report.scores.skills));
  lines.push(
    distributionLine("stockés", report.stored.total) +
      `  (dernier recalcul : ${report.stored.computedAt ?? "—"})`,
  );

  lines.push(
    "",
    `Top ${report.top.length} — part avec un terme métier du candidat : ${pct(report.topBusinessTermShare)}`,
  );
  lines.push(
    `  ${padStart("#", 3)} ${padStart("score", 5)} ${padStart("ski", 3)} ${padStart("sen", 3)} ${padStart("sal", 3)} ${padStart("cul", 3)} ${padStart("gate", 4)} ${padStart("lex", 3)} ${pad("app.lex", 7)} ${pad("exig.", 5)} ${pad("métier", 6)} offre — entreprise [id] · inconnus`,
  );
  for (const t of report.top) {
    const c = t.components;
    lines.push(
      `  ${padStart(t.rank, 3)} ${padStart(t.score + (t.followed ? "*" : ""), 5)} ${padStart(c.skills, 3)} ${padStart(c.seniority, 3)} ${padStart(c.salary, 3)} ${padStart(c.culture, 3)} ${padStart(t.gate.toFixed(2), 4)} ${padStart(t.lexicalScore, 3)} ${pad(yesNo(t.lexical), 7)} ${pad(yesNo(t.requirement), 5)} ${pad(yesNo(t.businessTerm), 6)} ${truncate(t.title, 60)} — ${t.company ?? "—"} [${t.offerId}] · ${t.unknowns.join(", ") || "—"}`,
    );
  }
  if (report.top.some((t) => t.followed)) lines.push("  * entreprise suivie (bonus inclus)");
  return `${lines.join("\n")}\n`;
}

export function toJson(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
