/**
 * Banc de profils de référence du matching (issue #78) : outils communs.
 *
 * Chaque cas fige, sans réseau :
 * - un profil et ses garde-fous (FICTIFS) ;
 * - la distribution de chaque élément de la mémoire sur toute la base
 *   (nombre d'offres, médiane, p99 : ce que `memorySimilarityStats` calcule
 *   en SQL), d'où la plage calibrée du worker (`calibratedRange`) ;
 * - un jeu d'offres classées par famille, avec leurs similarités cosinus
 *   par élément ;
 * - des attentes de classement écrites (« les offres du métier dans le top
 *   N », « aucune offre hors métier au-dessus de X »).
 *
 * Les offres hors métier des profils développeur, commercial et
 * reconversion vont de la médiane à ~p85 de la distribution. Plus haut
 * (p97), une offre hors métier SANS terme lexical dépasse 60 avec le
 * `score.ts` actuel : c'est le cas du fondateur (profil audiovisuel, offres
 * du BTP au-dessus du p99), marqué `todo` jusqu'au correctif (#77).
 */
import type {
  CandidateProfile,
  CandidateRails,
  GapCode,
  MatchOffer,
} from "@/lib/matching/types";

/** `metier` : le métier du candidat ; `voisin` : métier proche, libre ; `hors` : hors métier. */
export type Family = "metier" | "voisin" | "hors";

export type BenchOffer = {
  offer: MatchOffer;
  family: Family;
  /** Similarité cosinus avec chaque élément de la mémoire, dans l'ordre de `memoryIds`. */
  similarities: number[];
};

export type BenchCase = {
  key: string;
  label: string;
  profile: CandidateProfile;
  rails: CandidateRails;
  /** Distribution de chaque élément de la mémoire sur toutes les offres de la base. */
  distribution: { count: number; median: number; p99: number }[];
  offers: BenchOffer[];
  expectations: {
    /** Toutes les offres `metier` sont dans le top N. */
    metierInTop: number;
    /** Aucune offre `hors` n'atteint ce score. */
    offTopicBelow: number;
    /** Part minimale du top `metierInTop` qui contient un terme métier du candidat. */
    businessTermShare?: number;
    /** Écart signalé sur chaque offre du métier (explication). */
    metierGap?: GapCode;
  };
  /** Attentes non tenues par le `score.ts` actuel : renvoi à l'issue du correctif. */
  todo?: string;
};

/** Identifiants des éléments embarqués de la mémoire : réalisations, puis expériences. */
export const memoryIds = (profile: CandidateProfile) => [
  ...profile.achievements.map((a) => a.id),
  ...(profile.experiences ?? []).map((e) => e.id),
];

export const OPEN_RAILS: CandidateRails = {
  minFixedSalary: null,
  targetTotalPackage: null,
  remotePolicy: null,
  minRemoteDays: null,
  contractTypes: [],
  excludedSectors: [],
  excludedCompanies: [],
  maxWeeklyHours: null,
  acceptsOnCall: true,
  acceptsRemoteOutsideZone: false,
  culturePreferences: [],
  locations: [],
};

export function offer(id: string, overrides: Partial<MatchOffer>): MatchOffer {
  return {
    id,
    title: "Poste",
    description: "",
    companyName: "Entreprise Exemple",
    sector: null,
    seniority: null,
    contractLabel: null,
    latitude: 48.85,
    longitude: 2.35,
    remotePolicy: "ONSITE",
    contractType: "CDI",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    ...overrides,
  };
}

/** Salaire annuel annoncé (en euros). */
export const salary = (min: number, max: number): Partial<MatchOffer> => ({
  salaryMin: min,
  salaryMax: max,
  salaryCurrency: "EUR",
  salaryPeriod: "YEAR",
});

/**
 * Similarités placées dans la distribution de chaque élément : `level` 0 =
 * médiane, 1 = p99, au-delà : plus haut que le top 1 % (un niveau par
 * élément, ou un seul pour tous). Arrondies au millième, comme des mesures.
 */
export function atLevels(
  distribution: BenchCase["distribution"],
  level: number | number[],
): number[] {
  return distribution.map((d, k) => {
    const l = Array.isArray(level) ? level[k]! : level;
    return Math.round((d.median + l * (d.p99 - d.median)) * 1000) / 1000;
  });
}
