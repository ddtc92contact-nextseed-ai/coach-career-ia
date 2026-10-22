import { describe, expect, it } from "vitest";
import { memoryEmbeddingText, offerEmbeddingText, textHash } from "@/lib/matching/embeddings";
import { truncateSafe } from "@/lib/text/truncate";

/**
 * Troncature sans moitié de paire de substitution (issue #71) : un émoji coupé
 * en deux rendait la requête d'embeddings illisible pour Mistral (400
 * « Invalid JSON payload »).
 */

const EMOJI = "🚀"; // U+1F680 : deux unités UTF-16.

describe("truncateSafe", () => {
  it("retire entièrement un émoji à cheval sur la limite", () => {
    const text = `abcd${EMOJI}efgh`;
    expect(truncateSafe(text, 5)).toBe("abcd");
    expect(truncateSafe(text, 5).isWellFormed()).toBe(true);
  });

  it("garde un émoji juste avant la limite", () => {
    const text = `abcd${EMOJI}efgh`;
    expect(truncateSafe(text, 6)).toBe(`abcd${EMOJI}`);
    expect(truncateSafe(text, 7)).toBe(`abcd${EMOJI}e`);
  });

  it("laisse inchangé un texte plus court que la limite", () => {
    expect(truncateSafe("court", 10)).toBe("court");
    expect(truncateSafe(`abcd${EMOJI}`, 6)).toBe(`abcd${EMOJI}`);
    expect(truncateSafe("", 3)).toBe("");
  });

  it("laisse inchangés les accents français (une unité chacun)", () => {
    const text = "Équipe œuvrant à Besançon, très élégant";
    expect(truncateSafe(text, text.length)).toBe(text);
    expect(truncateSafe(text, 12)).toBe(text.slice(0, 12));
  });

  it("rend toujours un texte bien formé", () => {
    const text = `é${EMOJI}à${EMOJI}${EMOJI}ç👩‍💻œ`;
    for (let max = 0; max <= text.length + 1; max++) {
      const cut = truncateSafe(text, max);
      expect(cut.isWellFormed()).toBe(true);
      expect(cut.length).toBeLessThanOrEqual(max);
      expect(text.startsWith(cut)).toBe(true);
    }
  });

  it("une limite nulle ou négative donne un texte vide", () => {
    expect(truncateSafe("abc", 0)).toBe("");
    expect(truncateSafe("abc", -1)).toBe("");
  });
});

describe("Texte des embeddings", () => {
  it("offre : un émoji à l'index 1999 n'est pas coupé en deux", () => {
    const title = "Développeur·se full-stack";
    const head = `${title}\n`;
    const description = `${"é".repeat(1999 - head.length)}${EMOJI} suite de la description`;
    expect(`${head}${description}`.indexOf(EMOJI)).toBe(1999);

    const text = offerEmbeddingText({ title, description });
    expect(text.isWellFormed()).toBe(true);
    expect(text.length).toBe(1999);
    expect(JSON.parse(JSON.stringify({ input: [text] }))).toEqual({ input: [text] });
    expect(JSON.stringify(text)).not.toMatch(/\\ud[89ab]/i);
  });

  it("offre : un titre seul au-delà de la limite est coupé proprement", () => {
    const title = `${"a".repeat(1999)}${EMOJI}`;
    const text = offerEmbeddingText({ title, description: "x" });
    expect(text).toBe("a".repeat(1999));
  });

  it("mémoire : un émoji à cheval sur la limite (1 500) est retiré", () => {
    const text = memoryEmbeddingText(`${"a".repeat(1499)}${EMOJI}b`);
    expect(text).toBe("a".repeat(1499));
    expect(text.isWellFormed()).toBe(true);
  });

  it("sans caractère astral à la limite, texte et empreinte inchangés (pas de ré-embarquement)", () => {
    const offer = {
      title: `Data engineer ${EMOJI}`,
      description: `Équipe ${EMOJI} à Besançon. ${"Python, SQL, Airflow — très bien. ".repeat(100)}`,
    };
    // Calcul d'avant #71 : `slice` en unités UTF-16.
    const head = `${offer.title}\n`;
    const before = head + offer.description.slice(0, 2000 - head.length);
    expect(offerEmbeddingText(offer)).toBe(before);
    expect(textHash(offerEmbeddingText(offer))).toBe(textHash(before));

    const memory = "Migration des pipelines vers Airflow, équipe de cinq ".repeat(40);
    expect(memoryEmbeddingText(memory)).toBe(memory.slice(0, 1500));
  });
});
