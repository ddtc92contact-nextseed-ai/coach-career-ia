import { describe, expect, it } from "vitest";
import {
  dedupKey,
  detectContractType,
  detectRemotePolicy,
  normalizeUrl,
  parseFranceTravailLocation,
  parseLocationLabel,
  tidyLocation,
} from "@/lib/radar/normalize";
import { parseRobots } from "@/lib/radar/robots";
import { htmlToText } from "@/lib/radar/text";

describe("détection du télétravail", () => {
  it.each([
    ["Poste en full remote", "FULL_REMOTE"],
    ["100 % télétravail possible", "FULL_REMOTE"],
    ["2 jours de télétravail par semaine", "HYBRID"],
    ["Télétravail partiel", "HYBRID"],
    ["Organisation en mode hybride", "HYBRID"],
    ["Pas de télétravail", "ONSITE"],
    ["Nous déployons un cloud hybride", "UNKNOWN"],
    ["Rejoignez notre équipe", "UNKNOWN"],
  ])("« %s » → %s", (text, expected) => {
    expect(detectRemotePolicy(text)).toBe(expected);
  });
});

describe("type de contrat", () => {
  it.each([
    ["Stage - Data Engineer", "INTERNSHIP"],
    ["Data Engineering Intern", "INTERNSHIP"],
    ["Assistant comptable en alternance", "APPRENTICESHIP"],
    ["Mission freelance React", "FREELANCE"],
    ["CDD 6 mois", "CDD"],
    ["Permanent", "CDI"],
    ["Full-time", "UNKNOWN"],
  ])("« %s » → %s", (text, expected) => {
    expect(detectContractType(text)).toBe(expected);
  });
});

describe("lieux", () => {
  it("lit les libellés ATS dans les deux ordres", () => {
    expect(parseLocationLabel("Paris, France")).toMatchObject({
      city: "Paris",
      country: "FR",
      remote: false,
    });
    expect(parseLocationLabel("France, Paris")).toMatchObject({ city: "Paris", country: "FR" });
    expect(parseLocationLabel("Paris")).toMatchObject({ city: "Paris", country: "FR" });
  });

  it("préfère le lieu en France et repère le 100 % remote", () => {
    expect(parseLocationLabel("United States, Remote; France, Remote")).toMatchObject({
      country: "FR",
      city: null,
      remote: true,
    });
    expect(parseLocationLabel("France, Paris; France, Remote")).toMatchObject({
      city: "Paris",
      remote: false,
    });
  });

  it("lit les libellés France Travail", () => {
    expect(parseFranceTravailLocation("75 - Paris 9e Arrondissement", "75009")).toEqual({
      city: "Paris",
      region: "Île-de-France",
      country: "FR",
    });
    expect(parseFranceTravailLocation("69 - LYON 03")).toEqual({
      city: "Lyon",
      region: "Auvergne-Rhône-Alpes",
      country: "FR",
    });
    expect(parseFranceTravailLocation("Ile-de-France")).toEqual({
      city: null,
      region: "Île-de-France",
      country: "FR",
    });
  });

  it("harmonise les régions françaises", () => {
    expect(tidyLocation({ city: "Paris", region: "Ile de France", country: "FR" }).region).toBe(
      "Île-de-France",
    );
    expect(tidyLocation({ city: "Paris", region: "Paris", country: "FR" }).region).toBeNull();
  });
});

describe("clés de dédoublonnage", () => {
  const paris = { city: "Paris", region: null, country: "FR" };

  it("rapproche un même poste publié sur deux sources", () => {
    const fromAts = dedupKey({
      companyName: "Alan",
      title: "IT Operations Specialist",
      location: paris,
    });
    const fromFt = dedupKey({
      companyName: "ALAN",
      title: "IT Operations Specialist (H/F)",
      location: paris,
    });
    expect(fromAts).not.toBeNull();
    expect(fromFt).toBe(fromAts);
  });

  it("ignore suffixes juridiques, marqueurs H/F et lieu dans l'intitulé", () => {
    expect(
      dedupKey({
        companyName: "Qonto SAS",
        title: "Account Executive - Paris (F/H)",
        location: paris,
      }),
    ).toBe(dedupKey({ companyName: "Qonto", title: "Account Executive", location: paris }));
  });

  it("distingue deux villes et refuse une entreprise inconnue", () => {
    const lyon = { ...paris, city: "Lyon" };
    expect(dedupKey({ companyName: "Alan", title: "Dev", location: paris })).not.toBe(
      dedupKey({ companyName: "Alan", title: "Dev", location: lyon }),
    );
    expect(dedupKey({ companyName: null, title: "Dev", location: paris })).toBeNull();
  });

  it("normalise les URL (www, paramètres, /apply)", () => {
    expect(normalizeUrl("https://jobs.lever.co/qonto/abc/apply?utm_source=x")).toBe(
      normalizeUrl("https://www.jobs.lever.co/qonto/abc/"),
    );
  });
});

describe("htmlToText", () => {
  it("décode le HTML échappé de Greenhouse", () => {
    expect(
      htmlToText(
        "&lt;p&gt;Bonjour &amp;amp; bienvenue&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Un&lt;/li&gt;&lt;/ul&gt;",
      ),
    ).toBe("Bonjour & bienvenue\n\n- Un");
  });
});

describe("robots.txt", () => {
  const robots = parseRobots(
    [
      "User-agent: *",
      "Disallow: /private",
      "Allow: /private/public",
      "",
      "User-agent: CoachCareerIA-Radar",
      "Disallow: /jobs/*.json$",
    ].join("\n"),
    "CoachCareerIA-Radar",
  );

  it("applique le groupe propre à notre agent", () => {
    expect(robots.isAllowed("/jobs/1.json")).toBe(false);
    expect(robots.isAllowed("/jobs/1.html")).toBe(true);
    // Le groupe « * » ne s'applique plus quand un groupe nous vise.
    expect(robots.isAllowed("/private")).toBe(true);
  });

  it("la règle la plus précise l'emporte", () => {
    const generic = parseRobots(
      "User-agent: *\nDisallow: /private\nAllow: /private/public",
      "Autre",
    );
    expect(generic.isAllowed("/private/x")).toBe(false);
    expect(generic.isAllowed("/private/public/x")).toBe(true);
  });
});
