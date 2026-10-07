import { normalizeText } from "@/lib/matching/text";

/**
 * Repérage SIMPLE de critères potentiellement discriminatoires dans une offre
 * (âge, sexe, origine, situation familiale — Code du travail, art. L1132-1).
 * Un signalement n'est JAMAIS un refus automatique : l'offre passe en revue
 * par un administrateur, qui tranche. Les formules d'usage (« H/F »,
 * « 3 à 5 ans d'expérience », « sans distinction de sexe ») ne sont pas
 * signalées. Module pur : testable.
 */

export const FLAG_CATEGORIES = ["age", "sex", "origin", "family"] as const;
export type FlagCategory = (typeof FLAG_CATEGORIES)[number];

/** Motifs appliqués au texte normalisé (minuscules, sans accents). */
const PATTERNS: Record<FlagCategory, RegExp[]> = {
  age: [
    // « moins de 35 ans », « entre 25 et 35 ans », « 25-35 ans » (pas « ans d'expérience »).
    /\b(moins|plus) de \d{2} ans\b(?! d'?\s?(experience|anciennete|pratique))/,
    /\bentre \d{2} et \d{2} ans\b(?! d'?\s?(experience|anciennete|pratique))/,
    /\b\d{2} ?- ?\d{2} ans\b(?! d'?\s?(experience|anciennete|pratique))/,
    /\bage (de|entre|maximum|minimum|max|min|limite)\b/,
    /\bagee?s? de (moins|plus|\d{2})\b/,
    /\b(jeune|jeunes) (diplomee?s?|homme|femme|profil|candidate?s?|talents?)\b/,
    /\b(under|over|below|above) \d{2}\b(?! (years? of|yrs? of)? ?experience)/,
    /\b(aged|age limit|age range|young (man|woman|person|people|profile))\b/,
  ],
  sex: [
    /\b(hommes?|femmes?) (uniquement|seulement|exclusivement)\b/,
    /\b(uniquement|seulement|exclusivement) (des |une |un )?(hommes?|femmes?)\b/,
    /\bde sexe (masculin|feminin)\b/,
    /\b(male|female|men|women) only\b/,
    /\bonly (male|female|men|women)\b/,
  ],
  origin: [
    /\b(d'|de )?origine (francaise|europeenne|etrangere|maghrebine|africaine|asiatique)\b/,
    /\bnationalite (francaise|europeenne) (exigee|obligatoire|requise|uniquement)\b/,
    /\bde souche\b/,
    /\b(race|ethnie|ethnique|couleur de peau|caucasien|caucasian)\b/,
    /\b(langue maternelle|native speaker|natif|native) (uniquement|only|exige|exigee|requis|required)\b/,
    /\b(religion|religieuse?|confession)\b(?! ou | or )/,
  ],
  family: [
    /\b(mariee?s?|celibataires?|sans enfants?|pas d'enfants?|enceinte|grossesse)\b/,
    /\bsituation (familiale|matrimoniale)\b/,
    /\b(married|unmarried|pregnant|pregnancy|no children|childless|without children)\b/,
  ],
};

/** Formules légitimes neutralisées avant analyse. */
const ALLOWED = [
  /\bsans distinction (de|d') [^.;\n]{0,80}/g,
  /\b(regardless|irrespective) of [^.;\n]{0,80}/g,
  /\b(sans discrimination|without discrimination|equal opportunit\w*|egalite des chances)\b[^.;\n]{0,80}/g,
];

export type FlagResult = { category: FlagCategory; excerpt: string };

/**
 * Catégories signalées et extrait concerné (pour l'administrateur). Vide si
 * rien n'est repéré.
 */
export function detectDiscriminatoryCriteria(text: string): FlagResult[] {
  let normalized = normalizeText(text);
  for (const pattern of ALLOWED) normalized = normalized.replace(pattern, " ");
  const results: FlagResult[] = [];
  for (const category of FLAG_CATEGORIES) {
    for (const pattern of PATTERNS[category]) {
      const match = pattern.exec(normalized);
      if (match) {
        results.push({ category, excerpt: match[0] });
        break;
      }
    }
  }
  return results;
}

/** Texte d'une offre soumis au repérage. */
export function postingText(offer: { title: string; description: string }): string {
  return `${offer.title}\n${offer.description}`;
}
