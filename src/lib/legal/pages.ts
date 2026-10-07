/**
 * Pages légales publiques : `/<langue>/legal/<slug>`. Le texte de chaque page
 * vit dans `messages/*.json` (`legal.pages.<clé>`), le français faisant foi.
 */
export const LEGAL_PAGES = {
  notice: "mentions-legales",
  privacy: "confidentialite",
  terms: "conditions",
  companyTerms: "conditions-entreprises",
  ai: "ia",
} as const;

export type LegalPageKey = keyof typeof LEGAL_PAGES;

export const LEGAL_PAGE_KEYS = Object.keys(LEGAL_PAGES) as LegalPageKey[];

/** Chemin (sans langue) d'une page légale, avec une ancre facultative. */
export function legalPath(key: LegalPageKey, anchor?: string): string {
  return `/legal/${LEGAL_PAGES[key]}${anchor ? `#${anchor}` : ""}`;
}

export function legalPageFromSlug(slug: string): LegalPageKey | null {
  return LEGAL_PAGE_KEYS.find((key) => LEGAL_PAGES[key] === slug) ?? null;
}
