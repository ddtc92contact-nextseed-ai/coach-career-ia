import { describe, expect, it } from "vitest";
import { mapGreenhouseJob, type GreenhouseJob } from "@/lib/radar/connectors/greenhouse";
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
import { foldText, htmlToText } from "@/lib/radar/text";
import { company, fixtureJson } from "../helpers/radar";

/** Offre Doctolib réelle (Greenhouse, 2026-10-22) : poste à Nantes, hybride. */
const doctolib = () => fixtureJson<{ jobs: GreenhouseJob[] }>("greenhouse-doctolib.json").jobs[0]!;
const doctolibCompany = company({ slug: "doctolib", name: "Doctolib", boardToken: "doctolib" });

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

  it.each([
    "100 % télétravail",
    "Poste en 100% télétravail",
    "Ce poste est en full remote",
    "This is a fully remote role",
    "Remote only",
    "We are looking for a fully remote engineer",
    "Nous ne recrutons qu'en full remote",
    "Pas besoin de déménager : poste 100 % télétravail",
  ])("mention positive : « %s » → FULL_REMOTE", (text) => {
    expect(detectRemotePolicy(text)).toBe("FULL_REMOTE");
  });

  it.each([
    "Pas de 100 % télétravail",
    "Ce poste n'est pas pour vous si vous recherchez un poste 100 % en télétravail",
    "Le poste ne se fait pas en full remote",
    "Si vous cherchez un poste en full remote, passez votre chemin",
    "Vous souhaitez travailler en télétravail complet ? Ce poste ne vous conviendra pas",
    "Le 100 % télétravail n'est pas possible",
    "This is not a fully remote role",
    "Not for you if you're looking for remote only",
    "This role isn't fully remote",
    "If you want a full remote job, this position is not for you",
  ])("mention négative ou conditionnelle : « %s » → UNKNOWN", (text) => {
    expect(detectRemotePolicy(text)).toBe("UNKNOWN");
  });

  it("une mention négative n'empêche pas une mention positive ailleurs", () => {
    expect(
      detectRemotePolicy(
        "Ce n'est pas un poste en full remote.\nPoste en full remote pour l'équipe data.",
      ),
    ).toBe("FULL_REMOTE");
    // La négation s'arrête à la phrase ou à la puce.
    expect(
      detectRemotePolicy(
        "Faites demi-tour si…",
        "- Vous n'aimez pas la vente",
        "- Poste 100 % télétravail",
      ),
    ).toBe("FULL_REMOTE");
  });

  it("une mention négative laisse sa place aux autres motifs", () => {
    expect(detectRemotePolicy("Pas de full remote : 2 jours de télétravail par semaine")).toBe(
      "HYBRID",
    );
    expect(detectRemotePolicy("This is not a hybrid role")).toBe("UNKNOWN");
    expect(detectRemotePolicy("Pas plus de 2 jours de télétravail par semaine")).toBe("HYBRID");
    expect(detectRemotePolicy("Pas de télétravail, et pas de full remote")).toBe("ONSITE");
  });

  it("texte Doctolib : la rubrique « faites demi-tour si… » ne classe pas en FULL_REMOTE", () => {
    const job = doctolib();
    const description = htmlToText(job.content);
    expect(foldText(description)).toContain(
      "vous preferez un environnement de travail sans challenge vous recherchez un poste 100 en teletravail details du poste cdi temps plein nantes",
    );
    expect(detectRemotePolicy(job.title, description)).not.toBe("FULL_REMOTE");
    // Seule la rubrique négative parle de télétravail complet.
    expect(detectRemotePolicy("Vous recherchez un poste 100% en télétravail")).toBe("UNKNOWN");
  });

  it("Greenhouse : l'offre Doctolib reste à Nantes, hors télétravail complet", () => {
    const offer = mapGreenhouseJob(doctolib(), doctolibCompany)!;
    expect(offer.location).toMatchObject({ city: "Nantes" });
    expect(offer.remotePolicy).not.toBe("FULL_REMOTE");
    // « Poste éligible au format hybride (3 jours en présentiel / 2 jours en télétravail) ».
    expect(offer.remotePolicy).toBe("HYBRID");
  });

  it("Greenhouse : le lieu « Remote » reste un indicateur de télétravail complet", () => {
    const job = { ...doctolib(), location: { name: "France, Remote" } };
    expect(mapGreenhouseJob(job, doctolibCompany)!.remotePolicy).toBe("FULL_REMOTE");
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
