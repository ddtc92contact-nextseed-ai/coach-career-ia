import type {
  ContractTypeCode,
  EvidenceLevelCode,
  RemotePolicyCode,
  SeniorityCode,
} from "@/lib/career/codes";
import { isIdentityUrl, redactText } from "@/lib/import/pseudonymise";
import { CARD_LIMITS, type CardContent } from "./schema";

/**
 * Génération de la carte à partir de la mémoire de carrière PSEUDONYMISÉE
 * (jamais du coffre), par règles : aucune IA n'est nécessaire pour choisir
 * et résumer. Le candidat relit et modifie ensuite la carte.
 *
 * - accroche : intitulé du poste actuel ou le plus récent ;
 * - réalisations : les mieux prouvées d'abord, puis celles dont le résultat
 *   est chiffré ;
 * - compétences : uniquement celles qu'une réalisation utilise (« prouvée »
 *   dès qu'une réalisation prouvée l'utilise) ;
 * - garde-fous : salaire plancher arrondi au millier, télétravail, contrats,
 *   zone de recherche.
 * Les textes passent par la pseudonymisation déterministe (coordonnées,
 * liens et termes connus retirés).
 */

export type CardSource = {
  experiences: {
    roleTitle: string;
    seniority: SeniorityCode;
    startMonth: Date;
    endMonth: Date | null;
  }[];
  achievements: {
    title: string;
    result: string;
    evidenceLevel: EvidenceLevelCode;
    skills: string[];
    proofUrls: string[];
  }[];
  rails: {
    minFixedSalary: number | null;
    remotePolicy: RemotePolicyCode | null;
    minRemoteDays: number | null;
    contractTypes: ContractTypeCode[];
    locations: { label: string; radiusKm: number }[];
  } | null;
  /** Termes identifiants connus côté serveur (parties de l'e-mail, entreprises exclues). */
  knownTerms: string[];
};

const EVIDENCE_RANK: Record<EvidenceLevelCode, number> = { VERIFIED: 2, DOCUMENT: 1, DECLARED: 0 };
const isProvenLevel = (level: EvidenceLevelCode) => level !== "DECLARED";
const hasFigure = (text: string) => /\d/.test(text);

const MONTH_MS = 30.44 * 24 * 3_600_000;

/** Années d'expérience cumulées, périodes qui se chevauchent comptées une fois. */
export function yearsOfExperience(
  periods: { startMonth: Date; endMonth: Date | null }[],
  now: Date,
): number | null {
  if (periods.length === 0) return null;
  const spans = periods
    .map((p) => [p.startMonth.getTime(), (p.endMonth ?? now).getTime() + MONTH_MS] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of spans) {
    if (current && start <= current[1]) current[1] = Math.max(current[1], end);
    else {
      if (current) total += current[1] - current[0];
      current = [start, end];
    }
  }
  if (current) total += current[1] - current[0];
  return Math.floor(Math.round(total / MONTH_MS) / 12);
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function buildCard(source: CardSource, now: Date = new Date()): CardContent {
  const clean = (text: string, max: number) => clip(redactText(text, source.knownTerms).text, max);
  const latest = [...source.experiences].sort(
    (a, b) =>
      (b.endMonth ?? now).getTime() - (a.endMonth ?? now).getTime() ||
      b.startMonth.getTime() - a.startMonth.getTime(),
  )[0];

  const achievements = source.achievements
    .map((a, index) => ({ a, index }))
    .sort(
      (x, y) =>
        EVIDENCE_RANK[y.a.evidenceLevel] - EVIDENCE_RANK[x.a.evidenceLevel] ||
        Number(hasFigure(y.a.result)) - Number(hasFigure(x.a.result)) ||
        x.index - y.index,
    )
    .slice(0, 4)
    .map(({ a }) => ({
      title: clean(a.title, CARD_LIMITS.achievementTitle) || "…",
      result: clean(a.result, CARD_LIMITS.achievementResult),
      evidenceLevel: a.evidenceLevel,
      skills: [...new Set(a.skills.map((s) => clean(s, CARD_LIMITS.skill)).filter(Boolean))].slice(
        0,
        CARD_LIMITS.achievementSkills,
      ),
      proofUrls: a.proofUrls
        .filter((url) => /^https?:\/\//i.test(url) && !isIdentityUrl(url))
        .slice(0, CARD_LIMITS.proofUrls),
    }));

  // Compétences utilisées par une réalisation ; prouvées en premier.
  const skills = new Map<string, { name: string; proven: boolean }>();
  for (const a of source.achievements) {
    for (const raw of a.skills) {
      const name = clean(raw, CARD_LIMITS.skill);
      if (!name || name === "[…]") continue;
      const key = name.toLowerCase();
      const proven = isProvenLevel(a.evidenceLevel);
      const existing = skills.get(key);
      skills.set(key, { name: existing?.name ?? name, proven: proven || !!existing?.proven });
    }
  }
  const rails = source.rails;
  return {
    version: 1,
    headline: latest ? clean(latest.roleTitle, CARD_LIMITS.headline) : "",
    seniority: latest?.seniority ?? null,
    yearsOfExperience: yearsOfExperience(source.experiences, now),
    achievements,
    skills: [...skills.values()]
      .sort((a, b) => Number(b.proven) - Number(a.proven))
      .slice(0, CARD_LIMITS.skills),
    rails: {
      salaryFloor:
        rails?.minFixedSalary != null ? Math.round(rails.minFixedSalary / 1000) * 1000 : null,
      remotePolicy: rails?.remotePolicy ?? null,
      minRemoteDays: rails?.minRemoteDays ?? null,
      contractTypes: rails?.contractTypes ?? [],
      locations: (rails?.locations ?? []).slice(0, CARD_LIMITS.locations),
    },
    showSalary: rails?.minFixedSalary != null,
    showLocations: (rails?.locations.length ?? 0) > 0,
    allowProofUrls: false,
  };
}
