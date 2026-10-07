import { describe, expect, it } from "vitest";
import { evaluateOffer, rankOffers } from "@/lib/matching/score";
import {
  detectCulture,
  offerSeniorityRank,
  statedRemoteDays,
  statedWeeklyHours,
} from "@/lib/matching/signals";
import { CASES, OFFERS } from "../fixtures/matching/cases";
import { BAG_OF_WORDS_RANGE, bagOfWordsEmbedding, cosine } from "../helpers/matching";

/**
 * Jeu de référence (`tests/fixtures/matching`) : filtres ET classement
 * attendus, avec des embeddings « sac de mots » (aucun fournisseur). À
 * relancer après toute modification des règles, poids ou prompts.
 */

function similarities(profile: (typeof CASES)[number]["profile"]) {
  const memory = profile.achievements.map((a) => [a.id, bagOfWordsEmbedding(a.text)] as const);
  return new Map(
    OFFERS.map((offer) => {
      const vector = bagOfWordsEmbedding(`${offer.title}\n${offer.description}`);
      return [offer.id, new Map(memory.map(([id, v]) => [id, cosine(v, vector)]))] as const;
    }),
  );
}

describe.each(CASES)("jeu de référence : $name", (testCase) => {
  const { matches, excluded } = rankOffers(
    testCase.profile,
    testCase.rails,
    OFFERS,
    similarities(testCase.profile),
    BAG_OF_WORDS_RANGE,
  );
  const byId = new Map(matches.map((m) => [m.offerId, m]));

  it("exclut chaque offre attendue, pour la bonne règle", () => {
    for (const [offerId, code] of Object.entries(testCase.excluded)) {
      expect(byId.has(offerId), offerId).toBe(false);
      expect(excluded.find((e) => e.offerId === offerId)?.violations, offerId).toContain(code);
    }
  });

  it("classe les meilleures offres dans l'ordre attendu", () => {
    expect(matches.slice(0, testCase.top.length).map((m) => m.offerId)).toEqual(testCase.top);
  });

  it("les offres sans rapport restent sous le seuil de conservation", () => {
    for (const offerId of testCase.unrelated ?? []) {
      expect(byId.get(offerId)?.score ?? 0, offerId).toBeLessThan(40);
    }
  });

  it("signale les informations manquantes sans exclure l'offre", () => {
    for (const [offerId, unknowns] of Object.entries(testCase.unknowns ?? {})) {
      expect(byId.get(offerId)?.unknowns, offerId).toEqual(expect.arrayContaining(unknowns));
    }
  });

  it("chaque offre retenue a un score de 0 à 100 et des éléments d'explication", () => {
    for (const m of matches) {
      expect(m.score).toBeGreaterThanOrEqual(0);
      expect(m.score).toBeLessThanOrEqual(100);
      expect(Object.values(m.components).every((c) => c >= 0 && c <= 100)).toBe(true);
    }
  });
});

describe("score", () => {
  const [dataCase] = CASES;
  const great = OFFERS.find((o) => o.id === "de-great")!;

  it("relie une réalisation prouvée à l'exigence qui cite sa compétence", () => {
    const result = evaluateOffer(dataCase!.profile, dataCase!.rails, great, null);
    if (!result.pass) throw new Error("attendue retenue");
    expect(result.matches[0]).toMatchObject({
      achievementId: "a-pipeline",
      proven: true,
      requirement: expect.stringContaining("Airflow"),
    });
    expect(result.skills.slice(0, 3)).toEqual([
      { name: "Airflow", proven: true },
      { name: "Python", proven: true },
      { name: "SQL", proven: true },
    ]);
    expect(result.gaps).toContainEqual({ code: "unprovenSkill", value: "dbt" });
    expect(result.culture.sort()).toEqual(["ASYNC_FIRST", "LEARNING_CULTURE"]);
  });

  it("une compétence prouvée pèse plus qu'une compétence seulement déclarée", () => {
    const proven = { ...dataCase!.profile, skills: [{ name: "Airflow", proven: true }] };
    const declared = { ...dataCase!.profile, skills: [{ name: "Airflow", proven: false }] };
    const a = evaluateOffer(proven, dataCase!.rails, great, null);
    const b = evaluateOffer(declared, dataCase!.rails, great, null);
    if (!a.pass || !b.pass) throw new Error("attendues retenues");
    expect(a.components.skills).toBeGreaterThan(b.components.skills);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("la proximité sémantique favorise les réalisations prouvées", () => {
    const offer = { ...great, description: "Plateforme de données." };
    const profile = {
      ...dataCase!.profile,
      skills: [],
      achievements: dataCase!.profile.achievements.map((a) => ({ ...a, skills: [] })),
    };
    const proven = evaluateOffer(profile, dataCase!.rails, offer, new Map([["a-pipeline", 0.85]]));
    const declared = evaluateOffer(profile, dataCase!.rails, offer, new Map([["a-spark", 0.85]]));
    if (!proven.pass || !declared.pass) throw new Error("attendues retenues");
    expect(proven.components.skills).toBeGreaterThan(declared.components.skills);
    expect(proven.matches[0]).toMatchObject({ achievementId: "a-pipeline", requirement: null });
  });
});

describe("lecture des offres", () => {
  it("séniorité attendue (intitulé, puis expérience demandée)", () => {
    expect(offerSeniorityRank("Senior Data Engineer", null)).toBe(3);
    expect(offerSeniorityRank("Head of Data", null)).toBe(5);
    expect(offerSeniorityRank("Stagiaire data", null)).toBe(0);
    expect(offerSeniorityRank("Data Engineer", "5 An(s)")).toBe(3);
    expect(offerSeniorityRank("Data Engineer", "Débutant accepté")).toBe(1);
    expect(offerSeniorityRank("Data Engineer", null)).toBeNull();
  });
  it("horaires, jours de télétravail et culture", () => {
    expect(statedWeeklyHours("Poste à 37,5 h par semaine")).toBe(37.5);
    expect(statedWeeklyHours("Aucune indication")).toBeNull();
    expect(statedRemoteDays("Remote up to 2 days a week")).toBe(2);
    expect(statedRemoteDays("Télétravail partiel 3j/semaine")).toBe(3);
    // « Vos missions » ne fait pas une entreprise à mission.
    expect(detectCulture("Vos missions : piloter la roadmap.")).toEqual([]);
    expect(detectCulture("Entreprise à mission, B Corp.")).toEqual(["MISSION_DRIVEN"]);
  });
});
