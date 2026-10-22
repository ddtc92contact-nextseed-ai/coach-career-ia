import { describe, expect, it } from "vitest";
import {
  calibratedRange,
  DEFAULT_SEMANTIC_RANGE,
  evaluateOffer,
  rankOffers,
  similarityStats,
  type SemanticRange,
} from "@/lib/matching/score";
import { significantTerms } from "@/lib/matching/text";
import {
  AV_OFFERS,
  AV_PROFILE,
  AV_RAILS,
  avSimilarities,
  BACKGROUND_OFFERS,
  OFF_TOPIC_OFFERS,
} from "../fixtures/matching/audiovisual";

/**
 * Non-régression du journal de prod du 22/10 (issue #72) : la pertinence
 * d'abord. Les embeddings classaient bien les offres du métier, mais des
 * bornes fixes écrasaient l'écart et un salaire annoncé l'emportait.
 */

const offers = [...AV_OFFERS, ...OFF_TOPIC_OFFERS];
const similarities = avSimilarities();

/**
 * Calibration par élément de la mémoire, comme `memorySimilarityStats` en
 * SQL : sur TOUTES les offres du candidat (fond compris).
 */
function calibration() {
  const items = new Map<string, SemanticRange>();
  const ids = [...similarities.values().next().value!.keys()];
  for (const id of ids) {
    const values = [...AV_OFFERS, ...OFF_TOPIC_OFFERS, ...BACKGROUND_OFFERS].map((o) =>
      similarities.get(o.id)!.get(id)!,
    );
    items.set(id, calibratedRange(similarityStats(values), DEFAULT_SEMANTIC_RANGE));
  }
  return { fallback: DEFAULT_SEMANTIC_RANGE, items };
}

describe("pertinence d'abord : profil audiovisuel du 22/10", () => {
  const { matches } = rankOffers(AV_PROFILE, AV_RAILS, offers, similarities, calibration());
  const byId = new Map(matches.map((m) => [m.offerId, m]));
  const offTopic = OFF_TOPIC_OFFERS.map((o) => byId.get(o.id)!);
  const bestOffTopic = Math.max(...offTopic.map((m) => m.score));

  it("les 3 offres du métier, sans salaire, sortent en tête", () => {
    expect(
      matches
        .slice(0, 3)
        .map((m) => m.offerId)
        .sort(),
    ).toEqual(AV_OFFERS.map((o) => o.id).sort());
  });

  it("avec un écart net (≥ 15 points) sur la meilleure offre hors sujet salariée", () => {
    const worstAv = Math.min(...AV_OFFERS.map((o) => byId.get(o.id)!.score));
    expect(worstAv - bestOffTopic).toBeGreaterThanOrEqual(15);
    // Au-dessus du seuil de conservation ; la plupart des hors sujet en dessous.
    expect(worstAv).toBeGreaterThanOrEqual(40);
    const kept = offTopic.filter((m) => m.score >= 40).length;
    expect(kept).toBeLessThanOrEqual(OFF_TOPIC_OFFERS.length / 4);
  });

  it("explique : expériences proches du poste, salaire non indiqué neutre (#77)", () => {
    const av = byId.get("av-expert")!;
    expect(av.experiences.length).toBeGreaterThan(0);
    expect(av.experiences.map((e) => e.experience)).toContain("Technicien régie");
    expect(av.unknowns).toContain("salaryNotStated");
    // Neutre, sous un salaire annoncé au niveau du package (#77 : non annoncé ≠ parfait).
    expect(av.components.salary).toBe(70);
    expect(av.gaps.map((g) => g.code)).not.toContain("lowRelevance");
    // Hors sujet : salaire au-dessus du package, mais peu de rapport avec le parcours.
    expect(offTopic[0]!.components.salary).toBe(100);
    expect(offTopic[0]!.gaps.map((g) => g.code)).toContain("lowRelevance");
  });

  it("sans embeddings, le lexical (compétence partielle, expériences) classe encore le métier en tête", () => {
    const lexical = rankOffers(AV_PROFILE, AV_RAILS, [...AV_OFFERS, ...OFF_TOPIC_OFFERS], null);
    expect(
      lexical.matches
        .slice(0, 3)
        .map((m) => m.offerId)
        .sort(),
    ).toEqual(AV_OFFERS.map((o) => o.id).sort());
  });

  it("garde-fous toujours durs : un salaire sous le plancher exclut l'offre du métier", () => {
    const below = { ...AV_OFFERS[0]!, salaryMin: 24000, salaryMax: 26000, salaryCurrency: "EUR" };
    const result = evaluateOffer(AV_PROFILE, AV_RAILS, below, null);
    expect(result).toMatchObject({ pass: false, violations: ["salaryBelowFloor"] });
  });
});

describe("calibration de la similarité", () => {
  it("médiane → 0, p99 → P99_VALUE, maximum → 1 ; trop peu d'offres : bornes fixes", () => {
    const values = Array.from({ length: 1000 }, (_, i) => 0.6 + (0.2 * i) / 999);
    const stats = similarityStats(values);
    expect(stats.median).toBeCloseTo(0.7, 5);
    expect(stats.p99).toBeCloseTo(0.798, 3);
    expect(stats.max).toBeCloseTo(0.8, 5);
    expect(calibratedRange(stats, DEFAULT_SEMANTIC_RANGE)).toMatchObject({
      floor: stats.median,
      ceil: stats.p99,
      // Maximum à peine au-dessus du p99 : montée d'au moins un demi-écart.
      top: stats.p99 + 0.5 * (stats.p99 - stats.median),
    });
    expect(calibratedRange({ ...stats, count: 20 }, DEFAULT_SEMANTIC_RANGE)).toBe(
      DEFAULT_SEMANTIC_RANGE,
    );
    expect(calibratedRange(undefined, DEFAULT_SEMANTIC_RANGE)).toBe(DEFAULT_SEMANTIC_RANGE);
  });

  it("une offre médiane n'apporte rien, une offre du top 1 % une pertinence haute, sans saturer", () => {
    const profile = { ...AV_PROFILE, skills: [], experiences: [] };
    const range = { floor: 0.681, ceil: 0.776 };
    const at = (sim: number) => {
      const r = evaluateOffer(
        profile,
        AV_RAILS,
        OFF_TOPIC_OFFERS[0]!,
        new Map([["av-achievement", sim]]),
        range,
      );
      if (!r.pass) throw new Error("attendue retenue");
      return r.components.skills;
    };
    expect(at(0.681)).toBe(0);
    // #77 : le p99 ne vaut plus 1 (une seule réalisation déclarée : × 0,85).
    expect(at(0.79)).toBeGreaterThanOrEqual(60);
    expect(at(0.85)).toBeGreaterThan(at(0.79) + 10);
    expect(at(0.733)).toBeLessThan(30);
  });
});

describe("lexical : termes significatifs pondérés", () => {
  it("sans mots vides, le métier pèse plus que le rôle générique", () => {
    expect(significantTerms("Gestionnaire régie audiovisuel")).toEqual([
      { term: "gestionnaire", weight: 0.25 },
      { term: "regie", weight: 1 },
      { term: "audiovisuel", weight: 1 },
    ]);
    expect(significantTerms("Technicien d'exploitation (H/F)").map((t) => t.term)).toEqual([
      "technicien",
      "exploitation",
    ]);
    expect(significantTerms("node.js, c++ et C#").map((t) => t.term)).toEqual([
      "node.js",
      "c++",
      "c#",
    ]);
  });

  it("appariement partiel : « audiovisuel » seul cite la compétence, « gestionnaire » seul non", () => {
    const profile = { ...AV_PROFILE, achievements: [], experiences: [] };
    const av = evaluateOffer(profile, AV_RAILS, AV_OFFERS[0]!, null);
    const paie = evaluateOffer(profile, AV_RAILS, OFF_TOPIC_OFFERS[5]!, null);
    if (!av.pass || !paie.pass) throw new Error("attendues retenues");
    expect(av.skills).toEqual([{ name: "Gestionnaire régie audiovisuel", proven: false }]);
    expect(av.components.skills).toBeGreaterThan(0);
    expect(paie.skills).toEqual([]);
    expect(paie.components.skills).toBe(0);
  });
});
