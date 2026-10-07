import type { CareerMemoryDraft } from "@/lib/career/schemas";

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
};

export type ImportResult = {
  /** Partie pseudonymisée, au format de la mémoire de carrière. */
  draft: CareerMemoryDraft;
  /** Alignés sur `draft.experiences` et `draft.achievements`. */
  flags: { experiences: ItemFlags[]; achievements: ItemFlags[] };
  identity: IdentityPayload;
  sources: { cv: boolean; linkedin: boolean; github: boolean };
};

export type ImportResponse =
  { ok: true; result: ImportResult } | { ok: false; error: ImportErrorCode };
