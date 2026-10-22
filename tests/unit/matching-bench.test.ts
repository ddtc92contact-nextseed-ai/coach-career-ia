import { describe, expect, it } from "vitest";
import { businessTerms, hasBusinessTerm } from "@/lib/matching/audit";
import { checkGuardRails } from "@/lib/matching/filters";
import {
  calibratedRange,
  DEFAULT_SEMANTIC_RANGE,
  rankOffers,
  type SemanticRange,
} from "@/lib/matching/score";
import { BENCH_CASES, memoryIds, type BenchCase } from "../fixtures/matching/bench";

/**
 * Banc de profils de référence (issue #78) : quatre profils types, leurs
 * offres et des similarités figées, classés par le `score.ts` actuel comme
 * le ferait le worker (plage calibrée sur la distribution de chaque élément
 * de la mémoire). Les attentes de classement sont écrites dans chaque cas
 * (`tests/fixtures/matching/bench`). Une attente que le `score.ts` actuel
 * ne tient pas est marquée `todo` avec l'issue du correctif, jamais
 * supprimée.
 */

function rank(c: BenchCase) {
  const ids = memoryIds(c.profile);
  const items = new Map<string, SemanticRange>(
    ids.map((id, k) => [id, calibratedRange(c.distribution[k], DEFAULT_SEMANTIC_RANGE)]),
  );
  const similarities = new Map(
    c.offers.map((o) => [o.offer.id, new Map(ids.map((id, k) => [id, o.similarities[k]!]))]),
  );
  const { matches } = rankOffers(
    c.profile,
    c.rails,
    c.offers.map((o) => o.offer),
    similarities,
    { fallback: DEFAULT_SEMANTIC_RANGE, items },
  );
  const byId = new Map(c.offers.map((o) => [o.offer.id, o]));
  return matches.map((m, k) => ({ rank: k + 1, ...m, ...byId.get(m.offerId)! }));
}

/** Classement lisible, affiché quand une attente échoue. */
function table(ranked: ReturnType<typeof rank>): string {
  return ranked
    .map(
      (r) =>
        `${String(r.rank).padStart(3)} ${String(r.score).padStart(3)} skills ${String(r.components.skills).padStart(3)} ${r.family.padEnd(6)} ${r.offer.title}`,
    )
    .join("\n");
}

describe.each(BENCH_CASES)("banc de profils : $label", (c) => {
  const ranked = rank(c);
  const report = `\n${table(ranked)}`;
  const { metierInTop, offTopicBelow, businessTermShare, metierGap } = c.expectations;
  const expectation = c.todo ? it.skip : it;
  const todo = c.todo ? ` (todo ${c.todo})` : "";

  it("fixture cohérente : une similarité par élément, toutes les offres dans les garde-fous", () => {
    const ids = memoryIds(c.profile);
    expect(c.distribution).toHaveLength(ids.length);
    for (const o of c.offers) {
      expect(o.similarities, o.offer.id).toHaveLength(ids.length);
      expect(checkGuardRails(o.offer, c.rails).pass, o.offer.id).toBe(true);
    }
    expect(c.offers.filter((o) => o.family === "metier").length).toBeLessThanOrEqual(metierInTop);
    expect(ranked).toHaveLength(c.offers.length);
  });

  expectation(`les offres du métier dans le top ${metierInTop}${todo}`, () => {
    const outside = ranked.filter((r) => r.family === "metier" && r.rank > metierInTop);
    expect(
      outside.map((r) => r.offer.title),
      report,
    ).toEqual([]);
  });

  expectation(`aucune offre hors métier à ${offTopicBelow} ou plus${todo}`, () => {
    const above = ranked.filter((r) => r.family === "hors" && r.score >= offTopicBelow);
    expect(
      above.map((r) => `${r.offer.title} (${r.score})`),
      report,
    ).toEqual([]);
  });

  if (businessTermShare !== undefined) {
    expectation(
      `au moins ${businessTermShare * 100} % du top ${metierInTop} avec un terme métier${todo}`,
      () => {
        const terms = businessTerms(c.profile);
        const top = ranked.slice(0, metierInTop);
        const share = top.filter((r) => hasBusinessTerm(r.offer, terms)).length / top.length;
        expect(share, report).toBeGreaterThanOrEqual(businessTermShare);
      },
    );
  }

  if (metierGap !== undefined) {
    expectation(`chaque offre du métier signale « ${metierGap} »${todo}`, () => {
      for (const r of ranked.filter((o) => o.family === "metier")) {
        expect(
          r.gaps.map((g) => g.code),
          r.offer.title,
        ).toContain(metierGap);
      }
    });
  }
});
