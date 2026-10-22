import { describe, expect, it } from "vitest";
import { explanationFacts, factLines, ruleSummary } from "@/lib/matching/explanation";
import {
  calibratedRange,
  DEFAULT_SEMANTIC_RANGE,
  evaluateOffer,
  rankOffers,
  similarityStats,
  type SemanticRange,
} from "@/lib/matching/score";
import { AV_PROFILE, AV_RAILS } from "../fixtures/matching/audiovisual";
import {
  AV_OFFERS,
  BTP_OFFERS,
  MEMORY_IDS,
  PROD_ROWS,
  prodSimilarities,
} from "../fixtures/matching/audiovisual-btp";

/**
 * Non-régression de la prod du 22/10 après #75 (issue #77) : un classement
 * qui tient. Le clamp au p99 mettait ~180 offres ex æquo par élément, un
 * élément saturé suffisait à une pertinence pleine, et les offres du BTP,
 * sans aucun terme du métier, passaient devant les offres audiovisuelles.
 */

function scaleOf(distributions: Map<string, number[]>) {
  const items = new Map<string, SemanticRange>();
  for (const [id, values] of distributions) {
    items.set(id, calibratedRange(similarityStats(values), DEFAULT_SEMANTIC_RANGE));
  }
  return { fallback: DEFAULT_SEMANTIC_RANGE, items };
}

function rank(assignment?: readonly number[]) {
  const { offers, distributions } = prodSimilarities(assignment);
  const { matches } = rankOffers(
    AV_PROFILE,
    AV_RAILS,
    [...AV_OFFERS, ...BTP_OFFERS],
    offers,
    scaleOf(distributions),
  );
  return { matches, distributions };
}

/** Les 24 attributions des lignes du tableau aux 4 éléments de la mémoire. */
function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}

describe("reproduction de la prod du 22/10 (#77)", () => {
  it("la population reproduit les médianes et p99 mesurés", () => {
    const { distributions } = prodSimilarities();
    MEMORY_IDS.forEach((id, k) => {
      const stats = similarityStats(distributions.get(id)!);
      expect(stats.median).toBeCloseTo(PROD_ROWS[k]!.median, 2);
      expect(Math.abs(stats.p99 - PROD_ROWS[k]!.p99)).toBeLessThan(0.004);
    });
  });

  it.each(permutations([0, 1, 2, 3]))(
    "les 3 offres audiovisuelles devant tout le BTP, ≥ 10 points d'écart (lignes %j)",
    (...assignment) => {
      const { matches } = rank(assignment);
      const av = matches.filter((m) => m.offerId.startsWith("av-"));
      const btp = matches.filter((m) => m.offerId.startsWith("btp-"));
      expect(av).toHaveLength(3);
      expect(btp).toHaveLength(BTP_OFFERS.length);
      expect(matches.slice(0, 3).map((m) => m.offerId.slice(0, 3))).toEqual(["av-", "av-", "av-"]);
      const worstAv = Math.min(...av.map((m) => m.score));
      const bestBtp = Math.max(...btp.map((m) => m.score));
      expect(worstAv - bestBtp).toBeGreaterThanOrEqual(10);
    },
  );

  it("les scores s'étalent : plus de saturation de la pertinence", () => {
    const { matches } = rank();
    const skills = matches.map((m) => m.components.skills);
    expect(skills.filter((s) => s >= 90).length).toBeLessThanOrEqual(1);
    // Sans terme du métier, le BTP n'a qu'une pertinence partielle, expliquée.
    for (const m of matches.filter((x) => x.offerId.startsWith("btp-"))) {
      expect(m.components.skills).toBeLessThan(60);
      expect(m.gaps.map((g) => g.code)).toContain("noLexicalSupport");
      expect(m.skills).toEqual([]);
      expect(m.matches.every((x) => x.requirement === null)).toBe(true);
    }
    // 0,79 et 0,84 ne finissent jamais ex æquo : les offres AV se départagent.
    const av = matches.filter((m) => m.offerId.startsWith("av-")).map((m) => m.score);
    expect(new Set(av).size).toBe(3);
  });
});

describe("calibration sans saturation", () => {
  const stats = { count: 18_000, median: 0.68, p99: 0.78, max: 0.84 };
  const range = calibratedRange(stats, DEFAULT_SEMANTIC_RANGE);

  it("au-delà du p99, l'échelle continue jusqu'au maximum de la distribution", () => {
    expect(range).toEqual({ floor: 0.68, ceil: 0.78, top: 0.84 });
    const profile = { ...AV_PROFILE, skills: [], experiences: [] };
    const skills = (sim: number) => {
      const r = evaluateOffer(
        profile,
        AV_RAILS,
        BTP_OFFERS[0]!,
        new Map([["av-achievement", sim]]),
        range,
      );
      if (!r.pass) throw new Error("attendue retenue");
      return r.components.skills;
    };
    expect(skills(0.84)).toBeGreaterThan(skills(0.82));
    expect(skills(0.82)).toBeGreaterThan(skills(0.8));
    expect(skills(0.8)).toBeGreaterThan(skills(stats.p99));
    expect(skills(0.84) - skills(0.8)).toBeGreaterThanOrEqual(10);
  });

  it("un maximum aberrant n'écrase pas le haut de l'échelle ; un maximum collé au p99 ne sature pas", () => {
    // Montée p99 → haut de l'échelle : entre 0,5 et 2 écarts médiane → p99.
    expect(calibratedRange({ ...stats, max: 0.99 }, DEFAULT_SEMANTIC_RANGE).top).toBeCloseTo(
      0.98,
      6,
    );
    expect(calibratedRange({ ...stats, max: 0.781 }, DEFAULT_SEMANTIC_RANGE).top).toBeCloseTo(
      0.83,
      6,
    );
  });
});

describe("agrégation : un élément isolé ne suffit plus", () => {
  it("une seule expérience proche, sur quatre éléments, ne donne pas une pertinence pleine", () => {
    const profile = { ...AV_PROFILE, skills: [] };
    const offer = { ...BTP_OFFERS[0]!, title: "Technicien vidéo" };
    const range = { floor: 0.68, ceil: 0.78, top: 0.84 };
    const sims = (values: number[]) => new Map(MEMORY_IDS.map((id, k) => [id, values[k]!]));
    const one = evaluateOffer(profile, AV_RAILS, offer, sims([0.68, 0.84, 0.68, 0.68]), range);
    const all = evaluateOffer(profile, AV_RAILS, offer, sims([0.84, 0.84, 0.84, 0.84]), range);
    if (!one.pass || !all.pass) throw new Error("attendues retenues");
    expect(one.components.skills).toBeLessThan(60);
    expect(all.components.skills).toBeGreaterThan(one.components.skills + 25);
  });
});

describe("appui lexical", () => {
  const range = { floor: 0.68, ceil: 0.78, top: 0.84 };
  const sims = (sim: number) => new Map(MEMORY_IDS.map((id) => [id, sim]));
  const base = BTP_OFFERS[0]!;
  const cited = { ...base, title: "Technicien vidéo événementiel" };

  it("sans terme métier cité, une offre ne dépasse jamais une offre qui en cite, à sémantique égale", () => {
    for (const sim of [0.7, 0.75, 0.78, 0.8, 0.82, 0.84, 0.9]) {
      const without = evaluateOffer(AV_PROFILE, AV_RAILS, base, sims(sim), range);
      const withTerm = evaluateOffer(AV_PROFILE, AV_RAILS, cited, sims(sim), range);
      if (!without.pass || !withTerm.pass) throw new Error("attendues retenues");
      expect(withTerm.score, `similarité ${sim}`).toBeGreaterThan(without.score);
      expect(withTerm.components.skills).toBeGreaterThan(without.components.skills);
      expect(without.gaps.map((g) => g.code)).toContain("noLexicalSupport");
      expect(withTerm.gaps.map((g) => g.code)).not.toContain("noLexicalSupport");
    }
  });

  it("même avec un salaire annoncé face à une offre du métier sans salaire", () => {
    const noSalary = { ...cited, salaryMin: null, salaryMax: null, salaryCurrency: null };
    for (const sim of [0.78, 0.8, 0.84]) {
      const without = evaluateOffer(AV_PROFILE, AV_RAILS, base, sims(sim), range);
      const withTerm = evaluateOffer(AV_PROFILE, AV_RAILS, noSalary, sims(sim), range);
      if (!without.pass || !withTerm.pass) throw new Error("attendues retenues");
      expect(withTerm.score, `similarité ${sim}`).toBeGreaterThan(without.score);
    }
  });

  it("sans embeddings, l'offre sans terme métier n'a aucune pertinence", () => {
    const r = evaluateOffer(AV_PROFILE, AV_RAILS, base, null);
    if (!r.pass) throw new Error("attendue retenue");
    expect(r.components.skills).toBe(0);
    expect(r.gaps.map((g) => g.code)).toContain("noLexicalSupport");
  });
});

describe("salaire non annoncé : neutre, pas parfait", () => {
  const offer = AV_OFFERS[0]!;
  const sims = new Map(MEMORY_IDS.map((id) => [id, 0.8]));
  const range = { floor: 0.68, ceil: 0.78, top: 0.84 };
  const at = (overrides: Partial<typeof offer>, options?: { salaryNotStated?: number }) =>
    evaluateOffer(AV_PROFILE, AV_RAILS, { ...offer, ...overrides }, sims, range, options);

  it("violation (sous le plancher) < non annoncé < annoncé au niveau du package", () => {
    const below = at({ salaryMin: 24000, salaryMax: 26000, salaryCurrency: "EUR" });
    const unknown = at({});
    const atPackage = at({ salaryMin: 33000, salaryMax: 35000, salaryCurrency: "EUR" });
    expect(below).toMatchObject({ pass: false, violations: ["salaryBelowFloor"] });
    if (!unknown.pass || !atPackage.pass) throw new Error("attendues retenues");
    expect(unknown.components.salary).toBe(70);
    expect(unknown.unknowns).toContain("salaryNotStated");
    expect(atPackage.components.salary).toBe(100);
    expect(atPackage.score).toBeGreaterThan(unknown.score);
  });

  it("la valeur neutre se règle", () => {
    const unknown = at({}, { salaryNotStated: 0.5 });
    if (!unknown.pass) throw new Error("attendue retenue");
    expect(unknown.components.salary).toBe(50);
  });
});

describe("explication : une proximité n'est pas un rapprochement", () => {
  const { matches } = rank();
  const btp = matches.find((m) => m.offerId.startsWith("btp-"))!;
  const av = matches.find((m) => m.offerId === "av-expert")!;

  it("sans exigence citée, l'explication le dit, sans rien inventer", () => {
    const facts = explanationFacts(btp);
    const summary = ruleSummary(btp.score, facts, "fr");
    expect(summary).toContain(
      "Aucune exigence de l’offre ne cite vos compétences ni vos expériences : le score repose sur la seule proximité avec les missions du poste.",
    );
    expect(summary).not.toContain("expériences est proche du poste");
    const lines = factLines(facts, "fr");
    expect(lines.gaps.join(" ")).toContain("seule la proximité avec les missions du poste");
    for (const line of [...lines.matches, ...lines.experiences]) {
      expect(line).toContain("proche des missions du poste");
      expect(line).not.toContain("exigence");
    }
  });

  it("une offre du métier cite ses exigences", () => {
    const facts = explanationFacts(av);
    expect(facts.gaps.map((g) => g.code)).not.toContain("noLexicalSupport");
    expect(facts.experiences?.some((e) => e.requirement !== null)).toBe(true);
    expect(ruleSummary(av.score, facts, "fr")).not.toContain("Aucune exigence");
  });
});
