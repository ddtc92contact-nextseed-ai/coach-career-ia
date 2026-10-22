import type { ImportedDraft } from "@/lib/career/schemas";

/**
 * Règles et types de l'import IA partagés entre le serveur et l'interface
 * (aucune dépendance serveur).
 */

export const IMPORT_LIMITS = {
  /** CV PDF ou DOCX. */
  cvMaxBytes: 5 * 1024 * 1024,
  /** Archive « Obtenir une copie de vos données » de LinkedIn. */
  linkedinMaxBytes: 20 * 1024 * 1024,
  /** Taille décompressée maximale d'un CSV LinkedIn lu (protection « zip bomb »). */
  linkedinCsvMaxBytes: 5 * 1024 * 1024,
  /** Texte envoyé au modèle, par source. */
  cvMaxChars: 30_000,
  linkedinMaxChars: 30_000,
  githubMaxChars: 12_000,
  githubMaxRepos: 6,
  githubReadmeChars: 1_200,
  /** Imports par utilisateur et par heure (coût et abus). */
  importsPerHour: 10,
  /** Budget total côté serveur ; l'interface abandonne un peu après. */
  serverBudgetMs: 120_000,
  clientTimeoutMs: 135_000,
} as const;

export const CV_ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const LINKEDIN_ACCEPT = ".zip,application/zip,application/x-zip-compressed";

/** Identifiant GitHub : lettres, chiffres, tirets isolés, 39 caractères max. */
export const GITHUB_USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export const IMPORT_ERRORS = [
  "noSource",
  "cvTooLarge",
  "cvType",
  "cvEmpty",
  "linkedinTooLarge",
  "linkedinInvalid",
  "githubInvalid",
  "githubNotFound",
  "githubUnavailable",
  "aiNotConfigured",
  "aiTimeout",
  "aiUnavailable",
  "aiRateLimited",
  "aiInvalidOutput",
  "tooManyImports",
  "unauthorized",
  "network",
  "unknown",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERRORS)[number];

export function isImportErrorCode(value: unknown): value is ImportErrorCode {
  return typeof value === "string" && (IMPORT_ERRORS as readonly string[]).includes(value);
}

/** Erreurs passagères : l'interface propose de réessayer. */
export const RETRYABLE_IMPORT_ERRORS: readonly ImportErrorCode[] = [
  "aiTimeout",
  "aiUnavailable",
  "aiRateLimited",
  "githubUnavailable",
  "network",
  "unknown",
];

/** Contrôle côté navigateur avant l'envoi (le serveur revérifie le contenu). */
export function checkImportFile(
  kind: "cv" | "linkedin",
  file: { name: string; size: number } | null | undefined,
): ImportErrorCode | null {
  if (!file || file.size === 0) return null;
  const name = file.name.toLowerCase();
  if (kind === "cv") {
    if (file.size > IMPORT_LIMITS.cvMaxBytes) return "cvTooLarge";
    if (!name.endsWith(".pdf") && !name.endsWith(".docx")) return "cvType";
  } else {
    if (file.size > IMPORT_LIMITS.linkedinMaxBytes) return "linkedinTooLarge";
    if (!name.endsWith(".zip")) return "linkedinInvalid";
  }
  return null;
}

/**
 * Données identifiantes repérées : renvoyées au SEUL navigateur, jamais
 * stockées côté serveur. Elles iront au coffre d'identité (#4) quand il
 * existera ; sinon elles sont oubliées à la fin de la revue.
 */
export type IdentityPayload = {
  fullName: string | null;
  emails: string[];
  phones: string[];
  /** Liens qui révèlent l'identité (profil LinkedIn, GitHub, site personnel). */
  links: string[];
  /** Employeurs réels, reliés à l'expérience du brouillon (`ref`). */
  employers: { name: string; experienceRef: string | null }[];
  schools: { name: string; degree: string | null }[];
  /** Autres noms propres identifiants (clients, partenaires…). */
  organizations: string[];
};

/**
 * Dates d'une expérience que le candidat doit compléter avant de l'accepter :
 * - `startMissing` : aucune date de début lisible (`startMonth` vide) ;
 * - `startYearOnly` / `endYearOnly` : seule l'année est connue (mois mis à janvier) ;
 * - `startInFuture` : date de début postérieure au mois courant.
 */
export const DATE_ISSUES = [
  "startMissing",
  "startYearOnly",
  "endYearOnly",
  "startInFuture",
] as const;
export type DateIssue = (typeof DATE_ISSUES)[number];

/** Signalements d'un élément du brouillon, affichés pendant la revue. */
export type ItemFlags = {
  /** Un nom, un contact ou un employeur a été retiré du texte. */
  identityRemoved: boolean;
  /** Une preuve jointe est un lien qui peut révéler l'identité (dépôt GitHub…). */
  identifyingLink: boolean;
  /** Valeurs complétées ou corrigées automatiquement : à vérifier. */
  adjusted: boolean;
  /** Détails rares qui pourraient permettre de reconnaître le candidat (texte généré). */
  rareDetails: string[];
  /** Expériences : dates à compléter (vide = dates exploitables). */
  dateIssues: DateIssue[];
};

/** Raisons pour lesquelles un élément extrait n'a pas pu entrer dans le brouillon. */
export const DROP_REASONS = ["tooMany", "invalid"] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** Corrections automatiques d'une expérience gardée (journal d'import). */
export type DateAdjustment = "endInFuture" | "endBeforeStart" | "refRenamed";

/** Période en années ; `to: null` = jusqu'à aujourd'hui. */
export type YearSpan = { from: number; to: number | null };

/**
 * Contrôle de couverture : années citées dans le CV comparées à celles des
 * expériences du brouillon. `gap` indique de quel côté il manque plus de
 * `COVERAGE_TOLERANCE_YEARS` ans (`null` : rien à signaler).
 */
export type Coverage = {
  cv: YearSpan;
  memory: YearSpan | null;
  missingYears: { before: number; after: number };
  gap: "before" | "after" | "both" | "empty" | null;
};
export const COVERAGE_TOLERANCE_YEARS = 3;

/**
 * Bilan de l'import, montré à la revue et journalisé (compteurs seulement) :
 * chaque élément extrait par le modèle est soit gardé (éventuellement signalé),
 * soit compté dans `dropped`. Jamais d'abandon silencieux.
 */
export type ImportReport = {
  experiences: {
    /** Expériences renvoyées par le modèle. */
    extracted: number;
    /** Expériences présentes dans le brouillon (dont celles à compléter). */
    kept: number;
    /** Expériences gardées mais dont les dates sont à compléter. */
    flagged: number;
    dropped: number;
    /** Nombre d'expériences par problème de dates ou correction (journal). */
    reasons: Partial<Record<DateIssue | DateAdjustment | DropReason, number>>;
  };
  achievements: { extracted: number; kept: number; dropped: number };
  /** Éléments inutilisables, avec leur intitulé (pseudonymisé). */
  dropped: { kind: "experience" | "achievement"; title: string; reason: DropReason }[];
  /** `null` sans CV, ou quand le CV ne cite aucune année. */
  coverage: Coverage | null;
};

export type ImportResult = {
  /**
   * Partie pseudonymisée, au format de la mémoire de carrière. Une expérience
   * signalée (`flags.experiences[i].dateIssues`) peut avoir des dates
   * invalides (`startMonth` vide…) : elle doit être corrigée avant l'enregistrement,
   * qui revalide avec `CareerMemoryDraft`.
   */
  draft: ImportedDraft;
  /** Alignés sur `draft.experiences` et `draft.achievements`. */
  flags: { experiences: ItemFlags[]; achievements: ItemFlags[] };
  identity: IdentityPayload;
  sources: { cv: boolean; linkedin: boolean; github: boolean };
  report: ImportReport;
};

export type ImportResponse =
  { ok: true; result: ImportResult } | { ok: false; error: ImportErrorCode };
