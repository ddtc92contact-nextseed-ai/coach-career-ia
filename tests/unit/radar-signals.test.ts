import { describe, expect, it } from "vitest";
import {
  addWeeks,
  completedWeeks,
  detectSignals,
  hasEnoughHistory,
  mostRelevant,
  weekStart,
  weekStats,
  type DetectedSignal,
  type HistoryOffer,
} from "@/lib/radar/signals/compute";
import { isLeadershipRole, jobFamily } from "@/lib/radar/signals/families";
import {
  ORIGIN,
  freeze,
  newTeam,
  nothingHappening,
  remoteShift,
  repost,
  steady,
  surge,
  surgeWithDuplicates,
  tooFewOffers,
  tooYoung,
} from "../fixtures/radar/signals-histories";

const week = (n: number) => addWeeks(ORIGIN, n);

/** Signaux détectés sur les semaines `from`..`to` (incluses). */
function signalsOver(history: HistoryOffer[], from = 0, to = 10): DetectedSignal[] {
  return Array.from({ length: to - from + 1 }, (_, i) =>
    detectSignals(history, week(from + i)),
  ).flat();
}

const byWeek = (signals: DetectedSignal[]) =>
  signals.map((s) => [s.type, (s.periodStart.getTime() - ORIGIN.getTime()) / (7 * 86_400_000)]);

describe("semaines", () => {
  it("commencent le lundi à 00:00 UTC", () => {
    expect(weekStart(new Date("2026-06-07T23:59:00Z")).toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    expect(weekStart(new Date("2026-06-08T00:00:00Z")).toISOString()).toBe(
      "2026-06-08T00:00:00.000Z",
    );
  });

  it("ne recalcule que des semaines terminées", () => {
    const weeks = completedWeeks(new Date("2026-08-05T10:00:00Z"), 3);
    expect(weeks.map((w) => w.toISOString().slice(0, 10))).toEqual([
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
    ]);
  });
});

describe("familles de métiers", () => {
  it("classe les intitulés, la data avant l'ingénierie", () => {
    expect(jobFamily("Senior Data Engineer")).toBe("DATA_AI");
    expect(jobFamily("Machine Learning Engineer (LLM)")).toBe("DATA_AI");
    expect(jobFamily("Développeur·se backend Go")).toBe("ENGINEERING");
    expect(jobFamily("Product Manager")).toBe("PRODUCT");
    expect(jobFamily("Account Executive Mid-Market")).toBe("SALES");
    expect(jobFamily("Chargé de recrutement RH")).toBe("PEOPLE");
    expect(jobFamily("Juriste droit social")).toBe("LEGAL");
    expect(jobFamily("Boulanger")).toBeNull();
  });

  it("repère les postes d'encadrement", () => {
    expect(isLeadershipRole("Head of Data", null)).toBe(true);
    expect(isLeadershipRole("Engineering Manager", null)).toBe(true);
    expect(isLeadershipRole("Directrice financière", null)).toBe(true);
    expect(isLeadershipRole("Développeur senior", null)).toBe(false);
  });
});

describe("statistiques hebdomadaires", () => {
  it("compte nouvelles offres, fermetures, ouvertes et délai médian", () => {
    const stats = weekStats(steady(10), week(3));
    expect(stats.newOffers).toBe(1);
    expect(stats.closedOffers).toBe(5);
    expect(stats.openAtStart).toBe(7);
    expect(stats.openCount).toBe(3);
    expect(stats.medianDaysToClose).toBe(22);
    expect(stats.salaryShare).toBe(0);
    expect(stats.remoteShare).toBe(1);
  });

  it("n'annonce pas de nouveautés sans historique suffisant", () => {
    const stats = weekStats(tooFewOffers(), week(8));
    expect(stats.newCities).toEqual([]);
    expect(stats.newFamilies).toEqual([]);
  });

  it("ne compte pas les doublons d'une autre source", () => {
    expect(weekStats(surgeWithDuplicates(), week(8)).newOffers).toBe(3);
  });
});

describe("signaux sur des historiques enregistrés", () => {
  it("rien à signaler pour une entreprise au recrutement régulier", () => {
    expect(signalsOver(nothingHappening())).toEqual([]);
  });

  it("aucun signal avec moins de 4 semaines ou moins de 3 offres d'historique", () => {
    expect(hasEnoughHistory(tooYoung(), week(8))).toBe(false);
    expect(signalsOver(tooYoung())).toEqual([]);
    expect(hasEnoughHistory(tooFewOffers(), week(8))).toBe(false);
    expect(signalsOver(tooFewOffers())).toEqual([]);
  });

  it("pic de recrutement : 8 nouvelles offres pour 1 par semaine d'habitude", () => {
    const signals = signalsOver(surge(), 0, 8);
    expect(byWeek(signals)).toEqual([["HIRING_SURGE", 8]]);
    expect(signals[0]).toMatchObject({
      strength: 3,
      facts: { type: "HIRING_SURGE", newOffers: 8, baselineNew: 1 },
    });
  });

  it("pas de pic quand les nouvelles offres sont des doublons", () => {
    expect(signalsOver(surgeWithDuplicates(), 0, 8)).toEqual([]);
  });

  it("gel : plus de nouvelles offres et fermetures massives", () => {
    const signals = signalsOver(freeze(), 0, 8).filter((s) => s.type === "HIRING_FREEZE");
    expect(byWeek(signals)).toEqual([["HIRING_FREEZE", 8]]);
    expect(signals[0]).toMatchObject({
      strength: 3,
      facts: { quietWeeks: 2, closedOffers: 12, openBefore: 12, openCount: 0 },
    });
  });

  it("offre republiée : même clé après fermeture, ou offre rouverte", () => {
    const signals = signalsOver(repost());
    expect(byWeek(signals)).toEqual([["REPOSTED_OFFER", 6]]);
    expect(signals[0]).toMatchObject({
      strength: 2,
      facts: { count: 2, titles: ["Data analyst", "Account executive"] },
    });
  });

  it("nouvelle équipe (data + direction), puis nouvelle ville et nouveau pays", () => {
    const signals = signalsOver(newTeam());
    expect(byWeek(signals)).toEqual([
      ["NEW_TEAM", 6],
      ["NEW_LOCATION", 7],
      ["NEW_LOCATION", 8],
    ]);
    expect(signals[0]).toMatchObject({
      strength: 3,
      facts: { families: ["DATA_AI"], leadership: true, offers: 2 },
    });
    expect(signals[1]).toMatchObject({ strength: 1, facts: { cities: ["Lyon"], countries: [] } });
    expect(signals[2]).toMatchObject({
      strength: 3,
      facts: { cities: ["Berlin"], countries: ["DE"] },
    });
  });

  it("bascule télétravail : signalée une seule fois, à la première semaine", () => {
    const signals = signalsOver(remoteShift()).filter((s) => s.type === "REMOTE_SHIFT");
    expect(byWeek(signals)).toEqual([["REMOTE_SHIFT", 5]]);
    expect(signals[0]!.facts).toMatchObject({
      direction: "MORE_REMOTE",
      recentShare: 40,
      baselineShare: 0,
    });
  });

  it("est déterministe (même historique, mêmes signaux)", () => {
    const history = newTeam();
    expect(signalsOver(history)).toEqual(signalsOver(history));
  });
});

describe("pertinence", () => {
  it("garde le plus récent de chaque type, du plus fort au plus faible", () => {
    const s = (type: DetectedSignal["type"], strength: number, w: number) => ({
      type,
      strength,
      periodStart: week(w),
    });
    const ranked = mostRelevant(
      [
        s("NEW_LOCATION", 1, 7),
        s("NEW_LOCATION", 3, 8),
        s("NEW_TEAM", 3, 6),
        s("REMOTE_SHIFT", 1, 5),
      ],
      3,
    );
    expect(ranked.map((r) => [r.type, r.strength])).toEqual([
      ["NEW_LOCATION", 3],
      ["NEW_TEAM", 3],
      ["REMOTE_SHIFT", 1],
    ]);
  });
});
