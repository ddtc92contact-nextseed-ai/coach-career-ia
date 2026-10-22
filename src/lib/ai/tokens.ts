/**
 * Estimation PRUDENTE du nombre de jetons d'un texte, sans tokenizer : sert à
 * borner les lots d'embeddings (`AiClient.embed`), jamais à facturer.
 *
 * - lettres (accentuées comprises) et espaces : 1 jeton pour 3 caractères ;
 * - tout le reste (chiffres, ponctuation, symboles, emoji) : 1 jeton par
 *   caractère — les tokenizers SentencePiece de Mistral découpent les nombres
 *   chiffre par chiffre et isolent la plupart des symboles.
 *
 * Mesure en production (issue #69) : des lots de 32 descriptions d'offres de
 * 2 000 caractères font ~22 000 jetons réels, soit ~2,9 caractères par jeton ;
 * cette estimation donne ~2,7 sur le même texte (légère surestimation), et
 * reste proche de la réalité sur du texte dense (URL, listes, références).
 */

const DENSE = /[^\p{L}\s]/gu;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const dense = text.match(DENSE)?.length ?? 0;
  return Math.ceil((text.length - dense) / 3 + dense);
}

/** Début du texte dont l'estimation reste sous `maxTokens` (coupé entre deux caractères). */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  let cost = 0;
  let end = 0;
  for (const char of text) {
    cost += /[\p{L}\s]/u.test(char) ? 1 / 3 : 1;
    if (Math.ceil(cost) > maxTokens) break;
    end += char.length;
  }
  return text.slice(0, end);
}
