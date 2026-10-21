import { describe, expect, it } from "vitest";
import { detectSectors } from "@/lib/matching/signals";
import { loadCompanyConfig } from "@/lib/radar/companies";
import { interleaveByAts } from "@/lib/radar/job";
import { countsBySource, formatDuration } from "@/lib/radar/passes";
import type { RunSummary } from "@/lib/radar/pipeline";
import { company } from "../helpers/radar";

describe("liste de référence du radar (config/radar-companies.json)", () => {
  it("environ 500 entreprises, schéma valide, un board par entreprise", async () => {
    const config = await loadCompanyConfig("config/radar-companies.json");
    expect(config.length).toBeGreaterThanOrEqual(450);
    expect(config.length).toBeLessThanOrEqual(600);
    const boards = config.map((c) => `${c.ats}:${c.region ?? ""}:${c.boardToken.toLowerCase()}`);
    expect(new Set(boards).size).toBe(config.length);
  });

  it("chaque entreprise a un secteur reconnu par les garde-fous (exclusion par secteur)", async () => {
    const config = await loadCompanyConfig("config/radar-companies.json");
    const unknown = config.filter((c) => !c.sector || detectSectors(c.sector).length === 0);
    expect(unknown.map((c) => `${c.slug} (${c.sector ?? "sans secteur"})`)).toEqual([]);
  });

  it("SmartRecruiters reste inactif tant que son robots.txt exclut l'API", async () => {
    const config = await loadCompanyConfig("config/radar-companies.json");
    expect(config.filter((c) => c.ats === "smartrecruiters" && c.active)).toEqual([]);
  });
});

describe("passage du radar à grande échelle", () => {
  it("alterne les ATS en gardant l'ordre de chacun", () => {
    const gh = (slug: string) => company({ slug, atsType: "GREENHOUSE" });
    const wk = (slug: string) => company({ slug, atsType: "WORKABLE" });
    const lv = (slug: string, atsRegion: string | null = null) =>
      company({ slug, atsType: "LEVER", atsRegion });
    const ordered = interleaveByAts([
      gh("g1"),
      gh("g2"),
      gh("g3"),
      wk("w1"),
      wk("w2"),
      lv("l1"),
      lv("e1", "eu"),
    ]);
    expect(ordered.map((c) => c.slug)).toEqual(["g1", "w1", "l1", "e1", "g2", "w2", "g3"]);
  });

  it("compte périmètres, échecs et offres par source ; durée lisible", () => {
    const summary = (source: RunSummary["source"], status: RunSummary["status"], fetched = 0) =>
      ({
        source,
        sourceKey: `${source}:x`,
        status,
        complete: status === "SUCCESS",
        fetched,
        created: fetched,
        updated: 0,
        unchanged: 0,
        closed: 0,
        skipped: 0,
        duplicates: 0,
        error: null,
      }) satisfies RunSummary;
    expect(
      countsBySource([
        summary("greenhouse", "SUCCESS", 10),
        summary("greenhouse", "FAILED"),
        summary("lever", "SUCCESS", 3),
      ]),
    ).toEqual({
      greenhouse: { sources: 2, failed: 1, fetched: 10, created: 10, closed: 0 },
      lever: { sources: 1, failed: 0, fetched: 3, created: 3, closed: 0 },
    });
    expect(formatDuration(48_000)).toBe("48 s");
    expect(formatDuration(582_000)).toBe("9 min 42 s");
    expect(formatDuration(3_900_000)).toBe("1 h 05 min");
  });
});
