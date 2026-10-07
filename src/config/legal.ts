/**
 * Informations légales de l'éditeur (mentions légales, confidentialité,
 * conditions), lues UNIQUEMENT dans l'environnement (`LEGAL_*`) : aucune
 * donnée d'entreprise n'est écrite dans le code. Une valeur absente s'affiche
 * comme un tiret neutre (`LEGAL_MISSING`), jamais comme un texte à compléter.
 * Module sans dépendance serveur : testable.
 */

type Env = Record<string, string | undefined>;

/** Version des textes légaux acceptés à l'inscription (date de leur dernière mise à jour). */
export const LEGAL_TERMS_VERSION = "2026-10-07";

/** Rendu d'une information légale non renseignée. */
export const LEGAL_MISSING = "—";

export const LEGAL_ENV = {
  publisher: "LEGAL_PUBLISHER_NAME",
  brand: "LEGAL_BRAND",
  legalForm: "LEGAL_FORM",
  shareCapital: "LEGAL_SHARE_CAPITAL",
  siren: "LEGAL_SIREN",
  vatNumber: "LEGAL_VAT_NUMBER",
  address: "LEGAL_ADDRESS",
  phone: "LEGAL_PHONE",
  email: "LEGAL_EMAIL",
  director: "LEGAL_DIRECTOR",
  hostName: "LEGAL_HOST_NAME",
  hostAddress: "LEGAL_HOST_ADDRESS",
  hostPhone: "LEGAL_HOST_PHONE",
  emailProvider: "LEGAL_EMAIL_PROVIDER",
  mediator: "LEGAL_MEDIATOR",
} as const;

export type LegalField = keyof typeof LEGAL_ENV;
export type LegalInfo = Record<LegalField, string>;

/** Toutes les informations légales, chacune remplacée par `LEGAL_MISSING` si vide. */
export function legalInfo(env: Env = process.env): LegalInfo {
  const info = {} as LegalInfo;
  for (const [field, name] of Object.entries(LEGAL_ENV) as [LegalField, string][]) {
    const value = env[name]?.replace(/\s+/g, " ").trim();
    info[field] = value ? value : LEGAL_MISSING;
  }
  return info;
}

/** Date de mise à jour des textes (`LEGAL_TERMS_VERSION`), pour l'affichage. */
export function legalUpdatedAt(): Date {
  return new Date(`${LEGAL_TERMS_VERSION}T00:00:00Z`);
}
