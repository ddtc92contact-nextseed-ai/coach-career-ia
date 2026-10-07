import { createHash } from "node:crypto";
import { normalizeText } from "@/lib/matching/text";

/**
 * Embedding « sac de mots » déterministe pour les tests : deux textes qui
 * partagent du vocabulaire sont proches, contrairement aux vecteurs pseudo-
 * aléatoires du simulateur par défaut. Permet de tester le classement avec
 * une vraie notion de proximité, sans aucun fournisseur.
 */
const DIMENSIONS = 256;
const STOP_WORDS = new Set(
  "de la le les des du un une et en a au aux pour par sur avec dans vos votre nous notre the and of to in for with on our your is are".split(
    " ",
  ),
);

export function bagOfWordsEmbedding(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const token of normalizeText(text).split(/[^\p{L}\p{N}+#]+/u)) {
    if (token.length < 2 || STOP_WORDS.has(token)) continue;
    const index = createHash("sha256").update(token).digest().readUInt16BE(0) % DIMENSIONS;
    vector[index]! += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  return a.reduce((n, v, i) => n + v * b[i]!, 0);
}

/** Bornes de similarité adaptées au sac de mots (les vrais modèles sont plus « hauts »). */
export const BAG_OF_WORDS_RANGE = { floor: 0.05, ceil: 0.45 };
