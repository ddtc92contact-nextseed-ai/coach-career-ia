/**
 * Outils de texte du matching (fonctions pures) : normalisation sans accents
 * ni casse, recherche d'un terme entier, découpage en phrases.
 */

/** Minuscules, sans accents, apostrophes unifiées, espaces réduits. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Expression qui trouve `term` (déjà normalisé) comme terme entier : « java »
 * ne trouve pas « javascript », mais « c++ » ou « node.js » sont reconnus.
 */
export function termPattern(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}+#])`, "u");
}

/** Vrai si le texte normalisé contient le terme (normalisé) comme terme entier. */
export function containsTerm(normalizedText: string, term: string): boolean {
  const key = normalizeText(term);
  if (key.length < 1) return false;
  return termPattern(key).test(normalizedText);
}

/** Phrases ou lignes d'un texte (puces et retours à la ligne compris). */
export function sentences(text: string): string[] {
  return text
    .split(/\r?\n|(?<=[.!?;])\s+|\s[•·▪●◦*-]\s/)
    .map((s) => s.replace(/^[\s•·▪●◦*–-]+/, "").trim())
    .filter((s) => s.length >= 3);
}

/** Coupe un texte à `max` caractères sur une limite de mot. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}
