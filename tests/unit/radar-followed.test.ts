import { describe, expect, it } from "vitest";
import { createAiClient, createMockProvider, scriptedReplies } from "@/lib/ai";
import { LOCALES } from "@/i18n/routing";
import { buildExplanation, explanationFacts, parseExplanation } from "@/lib/matching/explanation";
import { companyIdInput, followQueryInput } from "@/lib/radar/follow-schemas";
import { FOLLOWED_COMPANY_BOOST, WEIGHTS, rankOffers } from "@/lib/matching/score";
import type { MatchOffer } from "@/lib/matching/types";
import { detectAtsBoard, looksLikeUrl, nameFromToken, probeBoard } from "@/lib/radar/careers";
import { CASES, OFFERS } from "../fixtures/matching/cases";
import { TEST_USER_AGENT, fakeFetch, fixture, jsonResponse, testHttp } from "../helpers/radar";

describe("détection de l'ATS d'une page carrières", () => {
  it.each([
    ["https://boards.greenhouse.io/dataiku", "GREENHOUSE", "dataiku", null],
    ["job-boards.greenhouse.io/doctolib/jobs/123", "GREENHOUSE", "doctolib", null],
    ["https://boards.greenhouse.io/embed/job_board?for=mistral", "GREENHOUSE", "mistral", null],
    ["https://boards-api.greenhouse.io/v1/boards/dataiku/jobs", "GREENHOUSE", "dataiku", null],
    ["https://jobs.lever.co/qonto", "LEVER", "qonto", null],
    ["https://jobs.lever.co/qonto/1b2c3d?lever-source=x", "LEVER", "qonto", null],
    ["https://jobs.eu.lever.co/mirakl", "LEVER", "mirakl", "eu"],
    ["https://api.eu.lever.co/v0/postings/mirakl?mode=json", "LEVER", "mirakl", "eu"],
    ["https://jobs.ashbyhq.com/alan", "ASHBY", "alan", null],
    ["https://jobs.ashbyhq.com/alan/0f3c-uuid", "ASHBY", "alan", null],
    ["https://careers.smartrecruiters.com/Nexity", "SMARTRECRUITERS", "Nexity", null],
    ["https://jobs.smartrecruiters.com/Nexity/7444-poste", "SMARTRECRUITERS", "Nexity", null],
    ["https://matera.recruitee.com/", "RECRUITEE", "matera", null],
    ["https://Matera.recruitee.com/o/developpeur", "RECRUITEE", "matera", null],
    ["https://apply.workable.com/exotec/", "WORKABLE", "exotec", null],
    ["https://apply.workable.com/exotec/j/ABC123/", "WORKABLE", "exotec", null],
    ["https://exotec.workable.com", "WORKABLE", "exotec", null],
  ])("%s → %s:%s", (input, atsType, boardToken, atsRegion) => {
    expect(detectAtsBoard(input)).toEqual({ atsType, boardToken, atsRegion });
  });

  it.each([
    "https://www.welcometothejungle.com/fr/companies/qonto/jobs",
    "https://careers.example.com/jobs",
    "https://www.linkedin.com/company/qonto/jobs",
    "https://boards.greenhouse.io/",
    "https://jobs.lever.co/",
    "https://apply.workable.com/api/v1/accounts",
    "https://boards.greenhouse.io/<script>",
    "ftp://jobs.lever.co/qonto",
    "https://boards.greenhouse.io/embed/job_board?for=..",
    "https://boards.greenhouse.io/embed/job_board?for=.",
    "https://jobs.lever.co/..%2F",
    "https://apply.workable.com/---",
    "javascript:alert(1)",
    "qonto",
  ])("%s : non pris en charge", (input) => {
    expect(detectAtsBoard(input)).toBeNull();
  });

  it("distingue une URL d'une recherche par nom", () => {
    expect(looksLikeUrl("https://jobs.lever.co/qonto")).toBe(true);
    expect(looksLikeUrl("jobs.lever.co/qonto")).toBe(true);
    expect(looksLikeUrl("matera.recruitee.com")).toBe(true);
    expect(looksLikeUrl("Qonto")).toBe(false);
    expect(looksLikeUrl("Crédit Agricole")).toBe(false);
  });

  it("nom lisible tiré du jeton", () => {
    expect(nameFromToken("la-belle-boite")).toBe("La Belle Boite");
  });
});

describe("validation d'un board (une requête, aucun site réel)", () => {
  it("Greenhouse : compte les offres ouvertes, User-Agent avec contact", async () => {
    const fetch = fakeFetch(() => jsonResponse(fixture("greenhouse-dataiku.json")));
    const probe = await probeBoard(testHttp(fetch), {
      atsType: "GREENHOUSE",
      boardToken: "dataiku",
      atsRegion: null,
    });
    const jobs = (JSON.parse(fixture("greenhouse-dataiku.json")) as { jobs: unknown[] }).jobs;
    expect(probe).toMatchObject({ ok: true, openOffers: jobs.length });
    expect(fetch.calls.map((c) => c.url)).toEqual([
      "https://boards-api.greenhouse.io/v1/boards/dataiku/jobs",
    ]);
    expect((fetch.calls[0]!.init.headers as Record<string, string>)["User-Agent"]).toBe(
      TEST_USER_AGENT,
    );
  });

  it("Workable : nom de l'entreprise et robots.txt respecté", async () => {
    const fetch = fakeFetch((url) =>
      url.endsWith("/robots.txt")
        ? new Response("User-agent: *\nDisallow: /private/")
        : jsonResponse(fixture("workable-exotec.json")),
    );
    const probe = await probeBoard(testHttp(fetch), {
      atsType: "WORKABLE",
      boardToken: "exotec",
      atsRegion: null,
    });
    expect(probe).toMatchObject({ ok: true, companyName: "Exotec" });
    expect(fetch.calls.map((c) => c.url)).toEqual([
      "https://apply.workable.com/robots.txt",
      "https://apply.workable.com/api/v1/widget/accounts/exotec",
    ]);
  });

  it("robots.txt interdit : injoignable, sans requête vers l'API", async () => {
    const fetch = fakeFetch(() => new Response("User-agent: *\nDisallow: /"));
    const probe = await probeBoard(testHttp(fetch), {
      atsType: "RECRUITEE",
      boardToken: "matera",
      atsRegion: null,
    });
    expect(probe).toEqual({ ok: false, reason: "unreachable" });
    expect(fetch.calls.map((c) => c.url)).toEqual(["https://matera.recruitee.com/robots.txt"]);
  });

  it("404 : board introuvable ; 500 : injoignable", async () => {
    const board = { atsType: "LEVER" as const, boardToken: "inconnue", atsRegion: null };
    const notFound = fakeFetch(() => new Response("Document not found", { status: 404 }));
    expect(await probeBoard(testHttp(notFound), board)).toEqual({ ok: false, reason: "notFound" });
    const down = fakeFetch(() => new Response("panne", { status: 500 }));
    expect(await probeBoard(testHttp(down), board)).toEqual({ ok: false, reason: "unreachable" });
  });
});

describe("classement : entreprises suivies", () => {
  const testCase = CASES[0]!;
  const offers: MatchOffer[] = OFFERS.map((o) => ({ ...o, companyId: `company-${o.id}` }));
  const base = rankOffers(testCase.profile, testCase.rails, offers, null);

  it("une offre d'une entreprise suivie gagne des points et la pastille", () => {
    const last = base.matches.at(-1)!;
    const followed = new Set([`company-${last.offerId}`]);
    const ranked = rankOffers(testCase.profile, testCase.rails, offers, null, undefined, followed);
    const boosted = ranked.matches.find((m) => m.offerId === last.offerId)!;
    expect(boosted.followed).toBe(true);
    expect(boosted.score).toBe(Math.min(100, last.score + FOLLOWED_COMPANY_BOOST));
    expect(ranked.matches.filter((m) => m.followed)).toHaveLength(1);
  });

  it("les garde-fous l'emportent : une offre exclue reste exclue même suivie", () => {
    expect(base.excluded.length).toBeGreaterThan(0);
    const followed = new Set(offers.map((o) => o.companyId!));
    const ranked = rankOffers(testCase.profile, testCase.rails, offers, null, undefined, followed);
    expect(ranked.excluded.map((e) => e.offerId).sort()).toEqual(
      base.excluded.map((e) => e.offerId).sort(),
    );
    // Entreprise de la meilleure offre suivie ET exclue : l'exclusion gagne.
    const top = offers.find((o) => o.id === base.matches[0]!.offerId)!;
    expect(top.companyName).toBeTruthy();
    const excludedCompany = { ...testCase.rails, excludedCompanies: [top.companyName!] };
    const strict = rankOffers(testCase.profile, excludedCompany, offers, null, undefined, followed);
    expect(strict.matches.map((m) => m.offerId)).not.toContain(top.id);
    expect(strict.excluded.find((e) => e.offerId === top.id)?.violations).toContain(
      "excludedCompany",
    );
  });
});

describe("explication du bonus « entreprise suivie »", () => {
  const testCase = CASES[0]!;
  const offers: MatchOffer[] = OFFERS.map((o) => ({ ...o, companyId: `company-${o.id}` }));
  // Offre loin du plafond : le bonus s'ajoute en entier.
  const first = rankOffers(testCase.profile, testCase.rails, offers, null).matches.find(
    (m) => m.score <= 100 - FOLLOWED_COMPANY_BOOST,
  )!;
  const followed = new Set([`company-${first.offerId}`]);
  const match = rankOffers(
    testCase.profile,
    testCase.rails,
    offers,
    null,
    undefined,
    followed,
  ).matches.find((m) => m.offerId === first.offerId)!;
  const title = offers.find((o) => o.id === first.offerId)!.title;

  it("détail du score + bonus = score affiché", () => {
    const facts = explanationFacts(match);
    const weighted =
      (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce(
        (n, key) => n + WEIGHTS[key] * facts.components[key],
        0,
      ) / Object.values(WEIGHTS).reduce((n, w) => n + w, 0);
    expect(match.baseScore).toBe(first.score);
    expect(facts.followedBonus).toBe(match.score - first.score);
    // Composantes arrondies à l'unité : écart d'arrondi d'au plus 1 point.
    expect(Math.abs(weighted + facts.followedBonus! - match.score)).toBeLessThanOrEqual(1);
  });

  it("score plafonné à 100 : seuls les points réellement ajoutés sont annoncés", () => {
    const capped = explanationFacts({ ...match, followedBoost: 3 });
    expect(capped.followedBonus).toBe(3);
    expect(explanationFacts({ ...match, followedBoost: 0 }).followedBonus).toBeUndefined();
  });

  it("les faits portent le bonus ; une offre non suivie n'en a pas", () => {
    expect(explanationFacts(match).followedBonus).toBe(FOLLOWED_COMPANY_BOOST);
    expect(explanationFacts(first).followedBonus).toBeUndefined();
  });

  it.each(LOCALES)("le résumé de secours cite le bonus (%s)", async (locale) => {
    const facts = explanationFacts(match);
    const explanation = await buildExplanation(
      { offerTitle: title, score: match.score, facts, locale },
      null,
    );
    expect(explanation.followedBonus).toBe(FOLLOWED_COMPANY_BOOST);
    expect(explanation.summary).toContain(String(FOLLOWED_COMPANY_BOOST));
    expect(parseExplanation(explanation)?.followedBonus).toBe(FOLLOWED_COMPANY_BOOST);
    const plain = await buildExplanation(
      { offerTitle: title, score: first.score, facts: explanationFacts(first), locale },
      null,
    );
    expect(plain.summary).not.toBe(explanation.summary);
  });

  it("le bonus est transmis à l'IA qui formule le résumé", async () => {
    const provider = createMockProvider({
      respond: scriptedReplies(
        JSON.stringify({ summary: "Bonne correspondance, avec le bonus de l’entreprise suivie." }),
      ),
    });
    const explanation = await buildExplanation(
      { offerTitle: title, score: match.score, facts: explanationFacts(match), locale: "fr" },
      createAiClient({ provider }),
    );
    expect(explanation).toMatchObject({ source: "llm", followedBonus: FOLLOWED_COMPANY_BOOST });
    const prompt = provider.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("followedCompanyBonus");
  });
});

describe("validation des entrées (zod)", () => {
  it("saisie : 2 à 500 caractères, espaces retirés", () => {
    expect(followQueryInput.safeParse("  Qonto ").data).toBe("Qonto");
    expect(followQueryInput.safeParse(" a ").error?.issues[0]?.message).toBe("tooShort");
    expect(followQueryInput.safeParse("x".repeat(501)).error?.issues[0]?.message).toBe("tooLong");
    expect(followQueryInput.safeParse(["a", "b"]).success).toBe(false);
  });

  it("identifiant d'entreprise : chaîne de 1 à 64 caractères", () => {
    expect(companyIdInput.safeParse("cmvi1s9ez000y4ul4gdxdtx3h").success).toBe(true);
    expect(companyIdInput.safeParse("").success).toBe(false);
    expect(companyIdInput.safeParse("x".repeat(65)).success).toBe(false);
    expect(companyIdInput.safeParse({ not: "x" }).success).toBe(false);
  });
});
