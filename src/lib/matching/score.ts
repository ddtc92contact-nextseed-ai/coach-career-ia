import type { CulturePreferenceCode } from "@/lib/career/codes";
import { isProven } from "@/lib/career/derive";
import { checkGuardRails } from "./filters";
import { annualSalary } from "./salary";
import {
  detectCulture,
  mentionsTravel,
  offerSeniorityRank,
  SENIORITY_RANK,
  travelDestination,
} from "./signals";
import { normalizeText, sentences, significantTerms, termPattern, truncate } from "./text";
import type {
  CandidateProfile,
  CandidateRails,
  GapCode,
  MatchOffer,
  UnknownCode,
  ViolationCode,
} from "./types";

/**
 * Score de 0 à 100 d'une offre qui respecte les garde-fous (issues #72 et
 * #77 : la pertinence d'abord, un classement qui tient).
 *
 * 1. PERTINENCE (`skills`, 60) : rapport entre l'offre et le parcours,
 *    combinaison « l'un ou l'autre » (1 − (1 − L)(1 − S)) de deux signaux :
 *    - lexical (L) : termes significatifs des compétences (une compétence
 *      prouvée pèse plus qu'une déclarée) et des intitulés d'expérience cités
 *      par l'offre, appariement partiel pondéré (le métier compte plus que le
 *      rôle générique, voir `significantTerms`) ;
 *    - sémantique (S) : similarité des embeddings des réalisations et des
 *      expériences, CALIBRÉE par candidat (`calibratedRange`) : la médiane
 *      de ses similarités vaut 0, son 99e centile `P99_VALUE`, et le haut
 *      de la distribution (son maximum) 1 : au-delà du p99, l'échelle
 *      continue de départager (#77 : ~180 offres ex æquo par élément au
 *      clamp du p99). Les éléments sont agrégés du meilleur au moins bon,
 *      chacun pesant `SEMANTIC_DECAY` fois le précédent : un élément isolé
 *      ne donne pas une pertinence pleine, l'ensemble du parcours compte.
 *      Une réalisation pèse plus qu'une simple expérience.
 *    APPUI LEXICAL : une offre qui ne cite AUCUN terme métier du candidat
 *    (compétences, intitulés et responsabilités des expériences) n'a que la
 *    proximité sémantique, multipliée par `UNSUPPORTED_FACTOR` (« noLexicalSupport ») :
 *    à sémantique égale, elle passe toujours sous une offre qui en cite un.
 * 2. CONTEXTE (séniorité 15, salaire 15, culture 10) : il ne compte en
 *    entier que pour une offre pertinente. Son poids est multiplié par
 *    `min(1, pertinence / RELEVANCE_FULL)` : une offre hors sujet ne peut pas
 *    dépasser une offre pertinente grâce à un salaire annoncé ou une
 *    séniorité lisible (la prod du 22/10 : 200 offres hors sujet devant les
 *    offres du métier). Choix plutôt qu'un seuil de pertinence : le score
 *    reste continu, et l'écart s'explique (« lowRelevance »).
 *
 * Une information absente donne un « inconnu » ; un salaire non annoncé est
 * neutre (`DEFAULT_SALARY_NOT_STATED`, réglable) : en dessous d'un salaire
 * annoncé au niveau du package visé, sans contredire le plancher, filtre dur.
 */

export const WEIGHTS = { skills: 60, seniority: 15, salary: 15, culture: 10 } as const;
export type Components = Record<keyof typeof WEIGHTS, number>;
const CONTEXT_KEYS = ["seniority", "salary", "culture"] as const;

/** Pertinence à partir de laquelle le contexte (salaire, séniorité, culture) compte en entier. */
export const RELEVANCE_FULL = 0.5;
/** Poids lexical d'une compétence seulement déclarée, face à une prouvée (1). */
export const DECLARED_WEIGHT = 0.5;
/** Poids lexical d'un intitulé d'expérience, face à une compétence prouvée (1). */
export const EXPERIENCE_WEIGHT = 0.4;
/**
 * Poids sémantique d'un élément de la mémoire : une réalisation garde plus
 * de poids qu'une simple expérience, et une preuve plus qu'une déclaration.
 */
export const SEMANTIC_WEIGHTS = { proven: 1, declared: 0.85, experience: 0.7 } as const;
/**
 * Agrégation des éléments de la mémoire, du plus proche au moins proche :
 * chacun pèse `SEMANTIC_DECAY` fois le précédent (moyenne pondérée). Un seul
 * élément proche, sur quatre, donne au plus ~53 % de sa valeur (#77).
 */
export const SEMANTIC_DECAY = 0.5;
/**
 * Pertinence d'une offre sans appui lexical (aucun terme métier du candidat
 * cité) : sa proximité sémantique seule, multipliée par ce facteur (#77).
 */
export const UNSUPPORTED_FACTOR = 0.6;
/**
 * Composante salaire d'une offre sans salaire annoncé (neutre), sous celle
 * d'un salaire au niveau du package visé (1) ; réglable (`config.ts`).
 */
export const DEFAULT_SALARY_NOT_STATED = 0.7;
/** Somme des poids lexicaux pour une composante lexicale pleine. */
const LEXICAL_SATURATION = 3;
/**
 * Proximité normalisée à partir de laquelle un élément, sans exigence citée,
 * est présenté comme proche des missions du poste : au-delà du p99
 * (`P99_VALUE`), dans le haut de la distribution.
 */
const SEMANTIC_MATCH_THRESHOLD = 0.85;
const MAX_PROOF_MATCHES = 5;
const MAX_EXPERIENCE_MATCHES = 3;
/**
 * Poids d'un terme des responsabilités d'une expérience trouvé dans
 * l'intitulé de l'offre (face à un terme métier de l'intitulé de l'expérience).
 */
const RESPONSIBILITY_TERM_WEIGHT = 0.5;
/** Termes de responsabilités d'une expérience retenus au plus (cherchés dans l'intitulé de l'offre). */
const MAX_RESPONSIBILITY_TERMS = 40;

/**
 * Échelle de similarité cosinus des embeddings : en dessous de `floor`
 * (médiane), rien en commun ; `ceil` (99e centile) vaut `P99_VALUE` ; `top`
 * (haut de la distribution ; défaut `ceil + MIN_TAIL × (ceil − floor)`,
 * comme mesuré avec mistral-embed) vaut 1, avec
 * une montée linéaire de `ceil` à `top`. `curve` (défaut `SEMANTIC_CURVE`)
 * > 1 creuse le milieu de l'échelle, sous `ceil`.
 */
export type SemanticRange = { floor: number; ceil: number; top?: number; curve?: number };
/**
 * Bornes fixes de repli, réglées pour mistral-embed (médiane ≈ 0,68, haut
 * de distribution ≈ 0,80 sur les offres réelles ; réglables par
 * l'environnement, voir `config.ts`) : utilisées quand la distribution du
 * candidat est trop petite pour être calibrée.
 */
export const DEFAULT_SEMANTIC_RANGE: SemanticRange = { floor: 0.68, ceil: 0.8 };

/**
 * Échelle par élément de la mémoire (identifiant de réalisation ou
 * d'expérience), avec un repli pour les éléments non calibrés.
 */
export type SemanticScale = { fallback: SemanticRange; items?: ReadonlyMap<string, SemanticRange> };

/** Distribution des similarités d'un élément de la mémoire sur les offres du candidat. */
export type SimilarityStats = { count: number; median: number; p99: number; max: number };

/** Nombre minimal d'offres pour calibrer (en deçà : bornes fixes). */
export const DEFAULT_CALIBRATION_MIN_SAMPLES = 200;
/**
 * Courbe de l'échelle sous le p99 (bornes calibrées comme fixes) : seul le
 * haut de la distribution compte. Calibrée : médiane 0, p90 ≈ 0,2, p97 ≈ 0,45,
 * p99 = `P99_VALUE`, puis montée linéaire jusqu'au maximum (1).
 */
export const SEMANTIC_CURVE = 2;
/**
 * Valeur normalisée du 99e centile. Le top 1 % (~180 offres sur 18 000)
 * garde de la place pour se départager : 0,79 et 0,84 ne finissent jamais
 * ex æquo (#77).
 */
export const P99_VALUE = 0.7;
/** Écart minimal médiane → p99 (distribution trop resserrée : rien ne se démarque). */
const MIN_CALIBRATION_SPREAD = 0.02;
/**
 * Longueur de la montée p99 → haut de l'échelle, en écarts médiane → p99 :
 * au moins `MIN_TAIL` (un maximum à peine au-dessus du p99 ne fait pas d'une
 * offre ordinaire une correspondance parfaite), au plus `MAX_TAIL` (une
 * seule offre aberrante n'écrase pas tout le haut de l'échelle).
 */
const MIN_TAIL = 0.5;
const MAX_TAIL = 2;

/**
 * Échelle calibrée sur la distribution d'un élément de la mémoire : la
 * médiane (offre quelconque) vaut 0, le 99e centile `P99_VALUE`, le maximum
 * 1. Les embeddings classent bien, mais leurs cosinus sont resserrés
 * (mistral-embed : 0,58 à 0,84) et leur niveau dépend du texte du candidat :
 * des bornes fixes écrasaient l'écart entre « audiovisuel » et « agent
 * immobilier » (#72), un plafond au p99 celui entre « audiovisuel » et
 * « maçon VRD » (#77).
 */
export function calibratedRange(
  stats: SimilarityStats | undefined,
  fallback: SemanticRange,
  minSamples = DEFAULT_CALIBRATION_MIN_SAMPLES,
): SemanticRange {
  if (!stats || stats.count < Math.max(1, minSamples)) return fallback;
  if (!Number.isFinite(stats.median) || !Number.isFinite(stats.p99)) return fallback;
  const floor = stats.median;
  const ceil = Math.max(stats.p99, stats.median + MIN_CALIBRATION_SPREAD);
  const spread = ceil - floor;
  const max = Number.isFinite(stats.max) ? stats.max : ceil + MIN_TAIL * spread;
  const top = Math.min(ceil + MAX_TAIL * spread, Math.max(ceil + MIN_TAIL * spread, max));
  return { floor, ceil, top };
}

/**
 * Médiane, 99e centile (interpolés, comme `percentile_cont`) et maximum
 * d'une liste de similarités.
 */
export function similarityStats(values: readonly number[]): SimilarityStats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    if (sorted.length === 0) return Number.NaN;
    const x = p * (sorted.length - 1);
    const i = Math.floor(x);
    const j = Math.min(i + 1, sorted.length - 1);
    return sorted[i]! + (sorted[j]! - sorted[i]!) * (x - i);
  };
  return { count: sorted.length, median: at(0.5), p99: at(0.99), max: at(1) };
}

export type ProofMatch = {
  achievementId: string;
  achievement: string;
  /** Exigence de l'offre (phrase citée) ; `null` = proximité avec les missions du poste. */
  requirement: string | null;
  proven: boolean;
};

export type ExperienceMatch = {
  experienceId: string;
  experience: string;
  /** Phrase de l'offre qui cite l'expérience ; `null` = proximité avec les missions du poste. */
  requirement: string | null;
};

export type Gap = { code: GapCode; value?: string };

/** Réglages du score (`config.ts`). */
export type ScoreOptions = {
  /** Composante salaire d'une offre sans salaire annoncé (défaut `DEFAULT_SALARY_NOT_STATED`). */
  salaryNotStated?: number;
};

export type Evaluation = {
  score: number;
  components: Components;
  matches: ProofMatch[];
  experiences: ExperienceMatch[];
  skills: { name: string; proven: boolean }[];
  culture: CulturePreferenceCode[];
  gaps: Gap[];
  unknowns: UnknownCode[];
  /** Ville citée avec les déplacements d'une offre en télétravail complet (`remoteWithTravel`). */
  travelPlace?: string;
};

export type OfferResult =
  | { offerId: string; pass: false; violations: ViolationCode[] }
  | ({
      offerId: string;
      pass: true;
      followed?: boolean;
      /** Score avant le bonus « entreprise suivie ». */
      baseScore?: number;
      /** Points réellement ajoutés pour l'entreprise suivie (après plafond à 100). */
      followedBoost?: number;
    } & Evaluation);

/**
 * Points ajoutés au score d'une offre d'une entreprise suivie par le
 * candidat (plafonné à 100). Appliqué APRÈS les garde-fous : une entreprise
 * ou un secteur exclus l'emportent toujours sur le suivi.
 */
export const FOLLOWED_COMPANY_BOOST = 10;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Similarité normalisée : 0 à la médiane, `P99_VALUE` au p99, 1 en haut de l'échelle. */
function normalizeSimilarity(similarity: number, range: SemanticRange): number {
  const spread = range.ceil - range.floor;
  if (similarity <= range.ceil) {
    const linear = clamp01((similarity - range.floor) / spread);
    return P99_VALUE * linear ** (range.curve ?? SEMANTIC_CURVE);
  }
  const top = Math.max(range.top ?? range.ceil + MIN_TAIL * spread, range.ceil + Number.EPSILON);
  return P99_VALUE + (1 - P99_VALUE) * clamp01((similarity - range.ceil) / (top - range.ceil));
}

function rangeFor(scale: SemanticRange | SemanticScale, itemId: string): SemanticRange {
  return "fallback" in scale ? (scale.items?.get(itemId) ?? scale.fallback) : scale;
}

// --- Lexique du candidat (préparé une fois par profil) ---

type Term = { term: string; weight: number; generic: boolean; pattern: RegExp };
/**
 * Source lexicale : une compétence ou une expérience. `phrase` (l'expression
 * entière) vaut un appariement complet ; sinon la part pondérée de `terms`
 * trouvés dans l'offre, plus les `titleTerms` (responsabilités) trouvés dans
 * son intitulé. Au moins un terme métier doit être trouvé.
 */
type LexicalSource = { phrase: RegExp | null; terms: Term[]; titleTerms: Term[]; total: number };
type Lexicon = {
  skills: { name: string; proven: boolean; source: LexicalSource }[];
  experiences: { id: string; title: string; source: LexicalSource }[];
};

const toTerms = (terms: { term: string; weight: number }[], weight = 1): Term[] => {
  // Que des termes génériques (« Management ») : ils disent alors le métier.
  const allGeneric = terms.every((t) => t.weight < 1);
  return terms.map((t) => {
    const generic = !allGeneric && t.weight < 1;
    return {
      term: t.term,
      weight: generic ? t.weight : weight,
      generic,
      pattern: termPattern(t.term),
    };
  });
};

function lexicalSource(label: string, responsibilities = ""): LexicalSource | null {
  const key = normalizeText(label);
  const parsed = toTerms(significantTerms(label));
  const own = new Set(parsed.map((t) => t.term));
  const titleTerms = toTerms(
    significantTerms(responsibilities, { common: false })
      .filter((t) => !own.has(t.term))
      .slice(0, MAX_RESPONSIBILITY_TERMS),
    RESPONSIBILITY_TERM_WEIGHT,
  );
  if (key.length < 1 && titleTerms.length === 0) return null;
  // Un seul terme : l'expression entière suffit (« Python », « c++ »).
  const terms = parsed.length >= 2 ? parsed : [];
  return {
    phrase: key.length > 0 ? termPattern(key) : null,
    terms,
    titleTerms,
    total: terms.length > 0 ? terms.reduce((n, t) => n + t.weight, 0) : 1,
  };
}

const lexicons = new WeakMap<CandidateProfile, Lexicon>();
function lexiconOf(candidate: CandidateProfile): Lexicon {
  let lexicon = lexicons.get(candidate);
  if (!lexicon) {
    lexicon = {
      skills: candidate.skills.flatMap((skill) => {
        const source = lexicalSource(skill.name);
        return source ? [{ ...skill, source }] : [];
      }),
      experiences: (candidate.experiences ?? []).flatMap((e) => {
        const source = lexicalSource(e.title, e.responsibilities);
        return source ? [{ id: e.id, title: e.title, source }] : [];
      }),
    };
    lexicons.set(candidate, lexicon);
  }
  return lexicon;
}

/**
 * Part (0 à 1) d'une source citée par l'offre, et l'expression ou le terme
 * le plus parlant trouvé (pour citer l'exigence) ; `null` sans terme métier.
 */
function matchSource(
  source: LexicalSource,
  offerText: string,
  titleText: string,
): { share: number; pattern: RegExp } | null {
  if (source.phrase?.test(offerText)) return { share: 1, pattern: source.phrase };
  const found = source.terms.filter((t) => t.pattern.test(offerText));
  const inTitle = source.titleTerms.filter((t) => t.pattern.test(titleText));
  const best = [...found, ...inTitle]
    .filter((t) => !t.generic)
    .sort((a, b) => b.weight - a.weight || b.term.length - a.term.length)[0];
  if (!best) return null;
  const weight = [...found, ...inTitle].reduce((n, t) => n + t.weight, 0);
  return { share: clamp01(weight / source.total), pattern: best.pattern };
}

/** Phrase de l'offre qui cite le terme (exigence), sinon l'intitulé. */
function requirementFor(offer: MatchOffer, pattern: RegExp): string | null {
  if (pattern.test(normalizeText(offer.title))) return truncate(offer.title, 140);
  const hit = sentences(offer.description).find((s) => pattern.test(normalizeText(s)));
  // Sans ponctuation finale : la phrase est citée entre guillemets dans une autre phrase.
  return hit ? truncate(hit.replace(/[\s.;:!]+$/, ""), 140) : null;
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
 * `similarities` : similarité cosinus offre ↔ élément de la mémoire (par
 * identifiant de réalisation ou d'expérience) ; absente si les embeddings
 * sont indisponibles. `scale` : échelle de ces similarités (fixe, ou
 * calibrée par élément).
 */
export function evaluateOffer(
  candidate: CandidateProfile,
  rails: CandidateRails,
  offer: MatchOffer,
  similarities: ReadonlyMap<string, number> | null,
  scale: SemanticRange | SemanticScale = DEFAULT_SEMANTIC_RANGE,
  options: ScoreOptions = {},
): OfferResult {
  const check = checkGuardRails(offer, rails);
  if (!check.pass) return { offerId: offer.id, pass: false, violations: check.violations };

  const unknowns = [...check.unknowns];
  const gaps: Gap[] = [];
  const offerText = normalizeText(`${offer.title}\n${offer.description}`);
  const titleText = normalizeText(offer.title);
  const lexicon = lexiconOf(candidate);

  // --- Télétravail complet, mais déplacements mentionnés (signal, jamais un filtre) ---
  let travelPlace: string | null = null;
  const fullText = `${offer.title}\n${offer.description}`;
  if (offer.remotePolicy === "FULL_REMOTE" && mentionsTravel(fullText)) {
    unknowns.push("remoteWithTravel");
    travelPlace = travelDestination(fullText);
  }

  // --- Lexical : compétences (preuve > déclaration) et intitulés d'expérience ---
  const matchedSkills: { name: string; proven: boolean; share: number; pattern: RegExp }[] = [];
  for (const skill of lexicon.skills) {
    const hit = matchSource(skill.source, offerText, titleText);
    if (hit) matchedSkills.push({ name: skill.name, proven: skill.proven, ...hit });
  }
  matchedSkills.sort(
    (a, b) =>
      Number(b.proven) - Number(a.proven) || b.share - a.share || a.name.localeCompare(b.name),
  );
  const experienceHits = new Map<string, { share: number; pattern: RegExp }>();
  for (const experience of lexicon.experiences) {
    const hit = matchSource(experience.source, offerText, titleText);
    if (hit) experienceHits.set(experience.id, hit);
  }
  const lexicalWeight =
    matchedSkills.reduce((n, s) => n + s.share * (s.proven ? 1 : DECLARED_WEIGHT), 0) +
    [...experienceHits.values()].reduce((n, h) => n + h.share * EXPERIENCE_WEIGHT, 0);
  const lexical = clamp01(lexicalWeight / LEXICAL_SATURATION);

  // --- Réalisations : exigence citée (via leurs compétences) ou proximité sémantique ---
  const matches: (ProofMatch & { strength: number })[] = [];
  const semanticValues: number[] = [];
  for (const achievement of candidate.achievements) {
    const proven = isProven(achievement.evidenceLevel);
    const sim = similarities?.get(achievement.id);
    const semantic =
      sim === undefined ? 0 : normalizeSimilarity(sim, rangeFor(scale, achievement.id));
    if (similarities) {
      semanticValues.push(semantic * SEMANTIC_WEIGHTS[proven ? "proven" : "declared"]);
    }

    const skill = matchedSkills.find((s) =>
      achievement.skills.some((name) => normalizeText(name) === normalizeText(s.name)),
    );
    const requirement = skill ? requirementFor(offer, skill.pattern) : null;
    if (requirement || semantic >= SEMANTIC_MATCH_THRESHOLD) {
      const evidence = proven ? 1 : DECLARED_WEIGHT;
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

  // --- Expériences : intitulé cité par l'offre ou proximité sémantique ---
  const experiences: (ExperienceMatch & { strength: number })[] = [];
  for (const experience of candidate.experiences ?? []) {
    const sim = similarities?.get(experience.id);
    const semantic =
      sim === undefined ? 0 : normalizeSimilarity(sim, rangeFor(scale, experience.id));
    if (similarities) semanticValues.push(semantic * SEMANTIC_WEIGHTS.experience);
    const hit = experienceHits.get(experience.id);
    const requirement = hit ? requirementFor(offer, hit.pattern) : null;
    if (requirement || semantic >= SEMANTIC_MATCH_THRESHOLD) {
      experiences.push({
        experienceId: experience.id,
        experience: truncate(experience.title, 120),
        requirement,
        strength: (hit?.share ?? 0) + semantic,
      });
    }
  }
  experiences.sort((a, b) => b.strength - a.strength);

  let semantic: number | null = null;
  if (similarities && semanticValues.length > 0) {
    // Du plus proche au moins proche, chaque élément pèse `SEMANTIC_DECAY` fois le précédent.
    const sorted = [...semanticValues].sort((a, b) => b - a);
    let sum = 0;
    let weights = 0;
    sorted.forEach((value, k) => {
      const w = SEMANTIC_DECAY ** k;
      sum += w * value;
      weights += w;
    });
    semantic = sum / weights;
  }
  // Appui lexical : au moins un terme métier du candidat cité par l'offre.
  const supported = matchedSkills.length > 0 || experienceHits.size > 0;
  const hasLexicon = lexicon.skills.length > 0 || lexicon.experiences.length > 0;
  let relevance: number;
  if (semantic === null) relevance = lexical;
  else if (supported || !hasLexicon) {
    // L'un OU l'autre signal suffit ; les deux ensemble renforcent la pertinence.
    relevance = 1 - (1 - lexical) * (1 - semantic);
  } else {
    // Sans aucun terme métier cité : la seule proximité sémantique, minorée.
    relevance = UNSUPPORTED_FACTOR * semantic;
  }
  if (!supported && hasLexicon) gaps.push({ code: "noLexicalSupport" });
  else if (matchedSkills.length === 0) gaps.push({ code: "fewSkills" });
  for (const skill of matchedSkills.filter((s) => !s.proven && s.share >= 1).slice(0, 2)) {
    gaps.push({ code: "unprovenSkill", value: skill.name });
  }

  // --- Séniorité ---
  const offerRank = offerSeniorityRank(offer.title, offer.seniority);
  const candidateRank = candidate.seniority ? SENIORITY_RANK[candidate.seniority] : null;
  const seniority = seniorityComponent(candidateRank, offerRank);
  if (seniority.unknown) unknowns.push("seniorityNotStated");
  if (seniority.gap) gaps.push({ code: seniority.gap });

  // --- Salaire face au package visé ---
  // Non annoncé : neutre (`salaryNotStated`), sous un salaire annoncé au
  // niveau du package visé, sans contredire le plancher (filtre dur). Un
  // salaire annoncé SOUS le package visé baisse la composante.
  const annual = annualSalary(offer);
  const target = rails.targetTotalPackage ?? rails.minFixedSalary;
  let salary = annual ? 1 : clamp01(options.salaryNotStated ?? DEFAULT_SALARY_NOT_STATED);
  if (annual && target && annual.max < target) {
    salary = clamp01((annual.max / target - 0.8) / 0.2);
    gaps.push({ code: "salaryBelowTarget" });
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
    skills: relevance,
    seniority: seniority.value,
    salary,
    culture,
  };
  // Pertinence d'abord : le contexte ne compte en entier que pour une offre pertinente.
  const gate = clamp01(relevance / RELEVANCE_FULL);
  if (gate < 1) gaps.push({ code: "lowRelevance" });
  const total = Object.values(WEIGHTS).reduce((n, w) => n + w, 0);
  const weighted =
    WEIGHTS.skills * components.skills +
    gate * CONTEXT_KEYS.reduce((n, key) => n + WEIGHTS[key] * components[key], 0);

  const withoutStrength = <T extends { strength: number }>({ strength, ...rest }: T) => {
    void strength;
    return rest;
  };
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
    matches: matches.slice(0, MAX_PROOF_MATCHES).map(withoutStrength),
    experiences: experiences.slice(0, MAX_EXPERIENCE_MATCHES).map(withoutStrength),
    skills: matchedSkills.slice(0, 8).map(({ name, proven }) => ({ name, proven })),
    culture: matchedCulture,
    gaps,
    unknowns,
    ...(travelPlace ? { travelPlace } : {}),
  };
}

/** Ordre du classement : score décroissant, puis identifiant (ordre stable). */
export const byRank = (
  a: { score: number; offerId: string },
  b: { score: number; offerId: string },
) => b.score - a.score || a.offerId.localeCompare(b.offerId);

/**
 * Classe des offres : celles qui violent un garde-fou sont écartées, les
 * autres triées par score décroissant (puis identifiant, pour un ordre stable).
 * Les offres des entreprises suivies (`followed`, identifiants `Company`)
 * gagnent `FOLLOWED_COMPANY_BOOST` points, sans jamais contourner un garde-fou.
 */
export function rankOffers(
  candidate: CandidateProfile,
  rails: CandidateRails,
  offers: MatchOffer[],
  similarities: ReadonlyMap<string, ReadonlyMap<string, number>> | null,
  scale?: SemanticRange | SemanticScale,
  followed: ReadonlySet<string> = new Set(),
  options: ScoreOptions = {},
) {
  const matches: Extract<OfferResult, { pass: true }>[] = [];
  const excluded: Extract<OfferResult, { pass: false }>[] = [];
  for (const offer of offers) {
    const result = evaluateOffer(
      candidate,
      rails,
      offer,
      similarities ? (similarities.get(offer.id) ?? new Map()) : null,
      scale,
      options,
    );
    if (!result.pass) {
      excluded.push(result);
      continue;
    }
    if (offer.companyId && followed.has(offer.companyId)) {
      const score = Math.min(100, result.score + FOLLOWED_COMPANY_BOOST);
      matches.push({
        ...result,
        followed: true,
        baseScore: result.score,
        followedBoost: score - result.score,
        score,
      });
    } else matches.push(result);
  }
  matches.sort(byRank);
  return { matches, excluded };
}
