import type { CulturePreferenceCode } from "@/lib/career/codes";
import { isProven } from "@/lib/career/derive";
import { checkGuardRails } from "./filters";
import { annualSalary } from "./salary";
import { detectCulture, offerSeniorityRank, SENIORITY_RANK } from "./signals";
import { normalizeText, sentences, termPattern, truncate } from "./text";
import type {
  CandidateProfile,
  CandidateRails,
  GapCode,
  MatchOffer,
  UnknownCode,
  ViolationCode,
} from "./types";

/**
 * Score de 0 à 100 d'une offre qui respecte les garde-fous, en quatre
 * composantes pondérées :
 * - compétences et preuves (50) : compétences du candidat citées par l'offre
 *   et proximité sémantique (embeddings) de ses réalisations ; ce qui est
 *   PROUVÉ pèse plus que ce qui est seulement déclaré ;
 * - séniorité (15) : écart entre le niveau attendu et celui du candidat ;
 * - salaire (20) : haut de fourchette annualisé face au package visé ;
 * - culture (15) : préférences du candidat mentionnées par l'offre.
 * Une information absente donne une composante neutre (0,5) et un « inconnu ».
 */

export const WEIGHTS = { skills: 50, seniority: 15, salary: 20, culture: 15 } as const;
export type Components = Record<keyof typeof WEIGHTS, number>;

/** Poids d'une réalisation ou compétence seulement déclarée, face à une prouvée (1). */
export const DECLARED_WEIGHT = 0.5;
/** Nombre de compétences prouvées citées par l'offre pour un score « compétences » plein. */
const LEXICAL_SATURATION = 3;
/** Proximité normalisée à partir de laquelle une réalisation « correspond » au poste. */
const SEMANTIC_MATCH_THRESHOLD = 0.6;
const MAX_PROOF_MATCHES = 5;

/**
 * Bornes de similarité cosinus des embeddings : en dessous de `floor`, rien
 * en commun ; au-dessus de `ceil`, correspondance maximale. Dépendent du
 * modèle (réglables par l'environnement, voir `config.ts`).
 */
export type SemanticRange = { floor: number; ceil: number };
export const DEFAULT_SEMANTIC_RANGE: SemanticRange = { floor: 0.55, ceil: 0.85 };

export type ProofMatch = {
  achievementId: string;
  achievement: string;
  /** Exigence de l'offre (phrase citée) ; `null` = proximité avec les missions du poste. */
  requirement: string | null;
  proven: boolean;
};

export type Gap = { code: GapCode; value?: string };

export type Evaluation = {
  score: number;
  components: Components;
  matches: ProofMatch[];
  skills: { name: string; proven: boolean }[];
  culture: CulturePreferenceCode[];
  gaps: Gap[];
  unknowns: UnknownCode[];
};

export type OfferResult =
  | { offerId: string; pass: false; violations: ViolationCode[] }
  | ({ offerId: string; pass: true } & Evaluation);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function normalizeSimilarity(similarity: number, range: SemanticRange): number {
  return clamp01((similarity - range.floor) / (range.ceil - range.floor));
}

/** Phrase de l'offre qui cite le terme (exigence), sinon l'intitulé. */
function requirementFor(offer: MatchOffer, pattern: RegExp): string | null {
  if (pattern.test(normalizeText(offer.title))) return truncate(offer.title, 140);
  const hit = sentences(offer.description).find((s) => pattern.test(normalizeText(s)));
  return hit ? truncate(hit, 140) : null;
}

function seniorityComponent(candidateRank: number | null, offerRank: number | null) {
  if (offerRank === null) return { value: 0.5, gap: undefined, unknown: true };
  if (candidateRank === null) return { value: 0.5, gap: undefined, unknown: false };
  const diff = offerRank - candidateRank;
  const value =
    diff === 0
      ? 1
      : diff === 1
        ? 0.6
        : diff === -1
          ? 0.8
          : diff === 2
            ? 0.25
            : diff === -2
              ? 0.4
              : 0;
  const gap: GapCode | undefined =
    diff >= 1 ? "seniorityAbove" : diff <= -2 ? "seniorityBelow" : undefined;
  return { value, gap, unknown: false };
}

/**
 * Évalue une offre : garde-fous d'abord (une violation exclut l'offre, sans
 * score), puis score et éléments d'explication.
 * `similarities` : similarité cosinus offre ↔ réalisation (par identifiant de
 * réalisation) ; absente si les embeddings sont indisponibles.
 */
export function evaluateOffer(
  candidate: CandidateProfile,
  rails: CandidateRails,
  offer: MatchOffer,
  similarities: ReadonlyMap<string, number> | null,
  range: SemanticRange = DEFAULT_SEMANTIC_RANGE,
): OfferResult {
  const check = checkGuardRails(offer, rails);
  if (!check.pass) return { offerId: offer.id, pass: false, violations: check.violations };

  const unknowns = [...check.unknowns];
  const gaps: Gap[] = [];
  const offerText = normalizeText(`${offer.title}\n${offer.description}`);

  // --- Compétences citées par l'offre (preuve > déclaration) ---
  const matchedSkills: { name: string; proven: boolean; pattern: RegExp }[] = [];
  for (const skill of candidate.skills) {
    const key = normalizeText(skill.name);
    if (key.length < 1) continue;
    const pattern = termPattern(key);
    if (pattern.test(offerText)) matchedSkills.push({ ...skill, pattern });
  }
  matchedSkills.sort((a, b) => Number(b.proven) - Number(a.proven) || a.name.localeCompare(b.name));
  const lexicalWeight = matchedSkills.reduce((n, s) => n + (s.proven ? 1 : DECLARED_WEIGHT), 0);
  const lexical = clamp01(lexicalWeight / LEXICAL_SATURATION);

  // --- Réalisations : exigence citée (via leurs compétences) ou proximité sémantique ---
  const matches: (ProofMatch & { strength: number })[] = [];
  const semanticValues: number[] = [];
  for (const achievement of candidate.achievements) {
    const proven = isProven(achievement.evidenceLevel);
    const evidence = proven ? 1 : DECLARED_WEIGHT;
    const sim = similarities?.get(achievement.id);
    const semantic = sim === undefined ? 0 : normalizeSimilarity(sim, range);
    if (similarities) semanticValues.push(semantic * evidence);

    const skill = matchedSkills.find((s) =>
      achievement.skills.some((name) => normalizeText(name) === normalizeText(s.name)),
    );
    const requirement = skill ? requirementFor(offer, skill.pattern) : null;
    if (requirement || semantic >= SEMANTIC_MATCH_THRESHOLD) {
      matches.push({
        achievementId: achievement.id,
        achievement: truncate(achievement.title, 120),
        requirement,
        proven,
        strength: evidence * (requirement ? 1 + semantic : semantic),
      });
    }
  }
  matches.sort((a, b) => b.strength - a.strength);

  let semantic: number | null = null;
  if (similarities && semanticValues.length > 0) {
    const sorted = [...semanticValues].sort((a, b) => b - a);
    const top = sorted.slice(0, 3);
    semantic = 0.7 * sorted[0]! + 0.3 * (top.reduce((n, v) => n + v, 0) / top.length);
  }
  const skillsValue = semantic === null ? lexical : 0.6 * lexical + 0.4 * semantic;
  if (matchedSkills.length === 0) gaps.push({ code: "fewSkills" });
  for (const skill of matchedSkills.filter((s) => !s.proven).slice(0, 2)) {
    gaps.push({ code: "unprovenSkill", value: skill.name });
  }

  // --- Séniorité ---
  const offerRank = offerSeniorityRank(offer.title, offer.seniority);
  const candidateRank = candidate.seniority ? SENIORITY_RANK[candidate.seniority] : null;
  const seniority = seniorityComponent(candidateRank, offerRank);
  if (seniority.unknown) unknowns.push("seniorityNotStated");
  if (seniority.gap) gaps.push({ code: seniority.gap });

  // --- Salaire face au package visé ---
  const annual = annualSalary(offer);
  const target = rails.targetTotalPackage ?? rails.minFixedSalary;
  let salary = 0.5;
  if (annual && target) {
    salary = annual.max >= target ? 1 : clamp01((annual.max / target - 0.8) / 0.2);
    if (annual.max < target) gaps.push({ code: "salaryBelowTarget" });
  } else if (annual) {
    salary = 0.6;
  }

  // --- Culture ---
  let culture = 0.5;
  const matchedCulture = rails.culturePreferences.length
    ? detectCulture(`${offer.title}\n${offer.description}`).filter((c) =>
        rails.culturePreferences.includes(c),
      )
    : [];
  if (rails.culturePreferences.length > 0) {
    if (matchedCulture.length === 0) unknowns.push("cultureNotStated");
    else {
      const wanted = Math.min(3, rails.culturePreferences.length);
      culture = 0.7 + 0.3 * clamp01(matchedCulture.length / wanted);
    }
  }

  const components: Components = {
    skills: skillsValue,
    seniority: seniority.value,
    salary,
    culture,
  };
  const total = Object.values(WEIGHTS).reduce((n, w) => n + w, 0);
  const weighted = (Object.keys(WEIGHTS) as (keyof Components)[]).reduce(
    (n, key) => n + WEIGHTS[key] * components[key],
    0,
  );

  return {
    offerId: offer.id,
    pass: true,
    score: Math.round((100 * weighted) / total),
    components: {
      skills: Math.round(components.skills * 100),
      seniority: Math.round(components.seniority * 100),
      salary: Math.round(components.salary * 100),
      culture: Math.round(components.culture * 100),
    },
    matches: matches.slice(0, MAX_PROOF_MATCHES).map(({ strength, ...m }) => {
      void strength;
      return m;
    }),
    skills: matchedSkills.slice(0, 8).map(({ name, proven }) => ({ name, proven })),
    culture: matchedCulture,
    gaps,
    unknowns,
  };
}

/**
 * Classe des offres : celles qui violent un garde-fou sont écartées, les
 * autres triées par score décroissant (puis identifiant, pour un ordre stable).
 */
export function rankOffers(
  candidate: CandidateProfile,
  rails: CandidateRails,
  offers: MatchOffer[],
  similarities: ReadonlyMap<string, ReadonlyMap<string, number>> | null,
  range?: SemanticRange,
) {
  const matches: Extract<OfferResult, { pass: true }>[] = [];
  const excluded: Extract<OfferResult, { pass: false }>[] = [];
  for (const offer of offers) {
    const result = evaluateOffer(
      candidate,
      rails,
      offer,
      similarities ? (similarities.get(offer.id) ?? new Map()) : null,
      range,
    );
    if (result.pass) matches.push(result);
    else excluded.push(result);
  }
  matches.sort((a, b) => b.score - a.score || a.offerId.localeCompare(b.offerId));
  return { matches, excluded };
}
