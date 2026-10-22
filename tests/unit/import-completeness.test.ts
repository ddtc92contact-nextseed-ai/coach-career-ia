import { describe, expect, it } from "vitest";
import { createAiClient, createMockProvider, scriptedReplies } from "@/lib/ai";
import { currentMonth, LIMITS } from "@/lib/career/schemas";
import { checkCoverage, cvYearSpan } from "@/lib/import/coverage";
import { buildResult, runImport, type BuildContext } from "@/lib/import/pipeline";
import { buildExtractionMessages, ExtractionSchema } from "@/lib/import/prompt";
import { createLinkTable } from "@/lib/import/pseudonymise";
import { createLogger } from "@/lib/logger";
import { IMPORT_CASES } from "../fixtures/import/cases";

/**
 * Import d'un long parcours (#79) : aucune expérience perdue en silence,
 * dates à compléter signalées, contrôle de couverture des années du CV.
 */

const silent = createLogger({ write: () => {} });
const technicien = IMPORT_CASES.find((c) => c.id === "cv-fr-technicien-audiovisuel")!;

function clientFor(...replies: Parameters<typeof scriptedReplies>) {
  const provider = createMockProvider({ respond: scriptedReplies(...replies) });
  return createAiClient({ provider, logger: silent, sleep: async () => {}, maxRetries: 1 });
}

const context = (cvText?: string): BuildContext => ({
  linkedin: null,
  github: null,
  links: createLinkTable(),
  contacts: { emails: [], phones: [], identityLinks: [] },
  cvText,
});

const experience = (overrides: Record<string, unknown> = {}) => ({
  ref: "exp-1",
  roleTitle: "Technicien vidéo",
  startMonth: "2010-03",
  endMonth: "2012-06",
  seniority: "MID",
  contractType: "CDI",
  sector: "MEDIA_ENTERTAINMENT",
  companySize: "S11_50",
  companyStage: "SME",
  responsibilities: "Montage.",
  ...overrides,
});

const extraction = (experiences: unknown[], achievements: unknown[] = []) =>
  ExtractionSchema.parse({ identity: null, experiences, achievements, skills: [] });

describe("Import : technicien audiovisuel 2000-2024 (périodes floues)", () => {
  async function run() {
    return runImport(technicien.sources(), { ai: clientFor(technicien.llmReply()), locale: "fr" });
  }

  it("toutes les périodes arrivent dans le brouillon, dans l'ordre du modèle", async () => {
    const { draft, report } = await run();
    expect(draft.experiences.map((e) => e.ref)).toEqual([
      "exp-1",
      "exp-2",
      "exp-3",
      "exp-4",
      "exp-5",
    ]);
    expect(report.experiences).toMatchObject({ extracted: 5, kept: 5, flagged: 3, dropped: 0 });
    expect(report.dropped).toEqual([]);
  });

  it("« depuis 2005 » et « 2010-2015 » sans mois sont signalés « dates à compléter »", async () => {
    const { draft, flags } = await run();
    const byRef = (ref: string) => {
      const index = draft.experiences.findIndex((e) => e.ref === ref);
      return { data: draft.experiences[index]!, issues: flags.experiences[index]!.dateIssues };
    };
    // Depuis 2005 : activité en cours, mois inconnu.
    expect(byRef("exp-1").data).toMatchObject({ startMonth: "2005-01" });
    expect(byRef("exp-1").data.endMonth).toBeUndefined();
    expect(byRef("exp-1").issues).toEqual(["startYearOnly"]);
    // Missions regroupées 2010-2015 : une seule expérience, début et fin à préciser.
    expect(byRef("exp-2").data).toMatchObject({ startMonth: "2010-01", endMonth: "2015-01" });
    expect(byRef("exp-2").issues).toEqual(["startYearOnly", "endYearOnly"]);
    // Sans aucune date : gardée, début vide.
    expect(byRef("exp-4").data.startMonth).toBe("");
    expect(byRef("exp-4").issues).toEqual(["startMissing"]);
    // Dates complètes : rien à signaler.
    expect(byRef("exp-3").issues).toEqual([]);
    expect(byRef("exp-5").issues).toEqual([]);
  });

  it("cas nominal : pas d'alerte de couverture", async () => {
    const { report } = await run();
    expect(report.coverage).toMatchObject({
      cv: { from: 2000, to: null },
      memory: { from: 2000, to: null },
      gap: null,
    });
  });

  it("le modèle oublie les périodes après 2004 : alerte de couverture", async () => {
    const reply = JSON.parse(technicien.llmReply());
    reply.experiences = reply.experiences.filter((e: { ref: string }) => e.ref === "exp-5");
    reply.achievements = [];
    const { report } = await runImport(technicien.sources(), {
      ai: clientFor(JSON.stringify(reply)),
      locale: "fr",
    });
    expect(report.coverage).toMatchObject({
      cv: { from: 2000, to: null },
      memory: { from: 2000, to: 2004 },
      gap: "after",
    });
    expect(report.coverage!.missingYears.after).toBeGreaterThan(3);
  });
});

describe("Import : aucune expérience retirée sans être comptée", () => {
  /** Générateur pseudo-aléatoire déterministe (rejouable). */
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  }
  const pick = <T>(next: () => number, values: readonly T[]) =>
    values[Math.floor(next() * values.length)]!;

  const DATES = [
    null,
    "",
    "2005",
    "2005-07",
    "1890",
    "2999-01",
    "2030",
    "abc",
    "2015-13",
    "2019-02",
  ];
  const REFS = ["", "  ", "exp-1", "exp-1", "exp-2", "li-1", "x".repeat(80)];
  const TITLES = ["", "   ", "Technicien", "Régisseur".repeat(30)];

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "brouillon aléatoire n°%i : extraites = gardées + écartées",
    (seed) => {
      const next = random(seed);
      const count = 20 + Math.floor(next() * 50); // parfois au-delà de la limite du brouillon
      const raw = Array.from({ length: count }, () =>
        experience({
          ref: pick(next, REFS),
          roleTitle: pick(next, TITLES),
          startMonth: pick(next, DATES),
          endMonth: pick(next, DATES),
          seniority: pick(next, ["MID", "inconnu", ""]),
        }),
      );
      const result = buildResult(extraction(raw), context());
      const { experiences } = result.report;
      expect(experiences.extracted).toBe(count);
      expect(experiences.kept).toBe(result.draft.experiences.length);
      expect(result.flags.experiences).toHaveLength(experiences.kept);
      expect(experiences.kept + experiences.dropped).toBe(count);
      expect(result.report.dropped.filter((d) => d.kind === "experience")).toHaveLength(
        experiences.dropped,
      );
      expect(experiences.flagged).toBe(
        result.flags.experiences.filter((f) => f.dateIssues.length > 0).length,
      );
      // Les refs restent uniques : les réalisations peuvent s'y rattacher.
      const refs = result.draft.experiences.map((e) => e.ref);
      expect(new Set(refs).size).toBe(refs.length);
    },
  );

  it("chaque branche de la boucle est comptée", () => {
    const now = currentMonth();
    const future = `${Number(now.slice(0, 4)) + 2}-01`;
    const raw = [
      experience({ ref: "", startMonth: null, endMonth: null }), // réf. vide, aucune date
      experience({ ref: "exp-1" }),
      experience({ ref: "exp-1", roleTitle: "Doublon de réf." }), // réf. déjà prise
      experience({ ref: "exp-3", startMonth: future, endMonth: null }), // début futur
      experience({ ref: "exp-4", startMonth: "2015-01", endMonth: future }), // fin future
      experience({ ref: "exp-5", startMonth: "2018-05", endMonth: "2016-02" }), // fin < début
      experience({ ref: "exp-6", startMonth: "2005", endMonth: "2008" }), // années seules
      experience({ ref: "exp-7", startMonth: "1890-01" }), // année illisible
      ...Array.from({ length: LIMITS.draftExperiences }, (_, i) =>
        experience({ ref: `extra-${i}`, roleTitle: `Mission ${i}` }),
      ),
    ];
    const { draft, flags, report } = buildResult(extraction(raw), context());
    expect(report.experiences).toEqual({
      extracted: raw.length,
      kept: LIMITS.draftExperiences,
      flagged: 4,
      dropped: raw.length - LIMITS.draftExperiences,
      reasons: {
        startMissing: 2,
        refRenamed: 2,
        startInFuture: 1,
        endInFuture: 1,
        endBeforeStart: 1,
        startYearOnly: 1,
        endYearOnly: 1,
        tooMany: raw.length - LIMITS.draftExperiences,
      },
    });
    // Les éléments écartés sont nommés pour la revue.
    expect(report.dropped[0]).toEqual({
      kind: "experience",
      title: "Mission 42",
      reason: "tooMany",
    });
    expect(draft.experiences[0]).toMatchObject({ ref: "exp-2", startMonth: "" });
    expect(draft.experiences[2]!.ref).toBe("exp-1-2");
    expect(flags.experiences[3]!.dateIssues).toEqual(["startInFuture"]);
    expect(draft.experiences[5]).toMatchObject({ startMonth: "2016-02", endMonth: "2018-05" });
  });

  it("les réalisations au-delà de la limite sont comptées et nommées", () => {
    const achievements = Array.from({ length: LIMITS.draftAchievements + 2 }, (_, i) => ({
      title: `Réalisation ${i}`,
      actions: "Action.",
    }));
    const { draft, report } = buildResult(extraction([], achievements), context());
    expect(draft.achievements).toHaveLength(LIMITS.draftAchievements);
    expect(report.achievements).toEqual({
      extracted: LIMITS.draftAchievements + 2,
      kept: LIMITS.draftAchievements,
      dropped: 2,
    });
    expect(report.dropped.map((d) => d.title)).toEqual([
      `Réalisation ${LIMITS.draftAchievements}`,
      `Réalisation ${LIMITS.draftAchievements + 1}`,
    ]);
  });
});

describe("Contrôle de couverture des années du CV", () => {
  const now = "2026-10";

  it("signale une mémoire qui s'arrête bien avant la fin du CV", () => {
    const cv = "Technicien vidéo\n1998 - 2004\nTechnicien son\n2004 - 2024";
    const coverage = checkCoverage(cv, [{ startMonth: "1998-01", endMonth: "2004-06" }], now);
    expect(coverage).toEqual({
      cv: { from: 1998, to: 2024 },
      memory: { from: 1998, to: 2004 },
      missingYears: { before: 0, after: 20 },
      gap: "after",
    });
  });

  it("ne signale rien quand les années se recouvrent (écart toléré : 3 ans)", () => {
    const cv = "Développeur, 2012 - 2016\nLead, mars 2016 – aujourd'hui";
    expect(checkCoverage(cv, [{ startMonth: "2013-09" }], now)?.gap).toBeNull();
  });

  it("signale un début de carrière manquant, et une mémoire vide", () => {
    const cv = "Assistant 2001-2008\nChef de projet 2008-2020";
    expect(checkCoverage(cv, [{ startMonth: "2008-01", endMonth: "2020-12" }], now)?.gap).toBe(
      "before",
    );
    expect(checkCoverage(cv, [{ startMonth: "" }], now)?.gap).toBe("empty");
  });

  it("ignore la formation, la naissance et les montants ; reconnaît « depuis » et « aujourd'hui »", () => {
    const cv = [
      "Née le 3 mai 1975",
      "Master — Université de Lyon (1996-1998)",
      "Budget de 2000 € par mois",
      "Ingénieure depuis 2003",
    ].join("\n");
    expect(cvYearSpan(cv, 2026)).toEqual({ from: 2003, to: null });
    expect(cvYearSpan("Consultant 2010 – present", 2026)).toEqual({ from: 2010, to: null });
    expect(cvYearSpan("Seit März 2019 bei einem Start-up", 2026)).toEqual({ from: 2019, to: null });
    expect(cvYearSpan("Aucune date ici", 2026)).toBeNull();
  });

  it("reconnaît une année suivie d'un point ou d'une virgule, pas les décimales", () => {
    const cv = "Technicien de 2000 à 2004.\nRégisseur de 2005 à 2024.";
    expect(cvYearSpan(cv, 2026)).toEqual({ from: 2000, to: 2024 });
    expect(cvYearSpan("Régisseur de 2005 à 2024, puis consultant", 2026)).toEqual({
      from: 2005,
      to: 2024,
    });
    expect(checkCoverage(cv, [{ startMonth: "2000-01", endMonth: "2004-12" }], now)?.gap).toBe(
      "after",
    );
    expect(cvYearSpan("Régisseur en 2010. Budget de 1,2050 M ; ratio 2030.5", 2026)).toEqual({
      from: 2010,
      to: 2010,
    });
  });

  it("pas de contrôle sans CV (LinkedIn ou GitHub seuls)", () => {
    const result = buildResult(extraction([experience()]), context());
    expect(result.report.coverage).toBeNull();
  });
});

describe("Consignes d'extraction", () => {
  it("demande toutes les périodes, les dates partielles et plusieurs réalisations", () => {
    const [system] = buildExtractionMessages({ cv: "CV" }, "fr");
    const rules = system!.content;
    expect(rules).toContain("EVERY period of activity");
    expect(rules).toMatch(/freelance/i);
    expect(rules).toMatch(/intermittent/i);
    expect(rules).toContain("grouped missions");
    expect(rules).toContain('"since');
    expect(rules).toContain('"YYYY" alone when only the year is known');
    expect(rules).toContain("startMonth is null if the start date is unknown");
    expect(rules).toContain("Extract ALL of them");
    expect(rules).toContain("skills (per experience)");
  });
});
