import { describe, expect, it } from "vitest";
import { buildCard, yearsOfExperience } from "@/lib/card/build";
import { checkCard, checkText, findTerm, vaultTerms } from "@/lib/card/reidentify";
import { cardSchema, publicCard, type CardContent } from "@/lib/card/schema";
import {
  cardLinkTtlDays,
  hashToken,
  isLinkActive,
  isTokenShape,
  linkExpiry,
  newToken,
} from "@/lib/card/tokens";

const NOW = new Date("2026-10-07T12:00:00Z");
const month = (iso: string) => new Date(`${iso}-01T00:00:00Z`);

function card(overrides: Partial<CardContent> = {}): CardContent {
  return cardSchema.parse({
    version: 1,
    headline: "Data engineer senior",
    seniority: "SENIOR",
    yearsOfExperience: 7,
    achievements: [
      {
        title: "Refonte du pipeline de données",
        result: "Temps de traitement divisé par 4, coûts cloud -30 %",
        evidenceLevel: "DOCUMENT",
        skills: ["Python", "Airflow"],
        proofUrls: [],
      },
    ],
    skills: [
      { name: "Python", proven: true },
      { name: "SQL", proven: false },
    ],
    rails: {
      salaryFloor: 60000,
      remotePolicy: "HYBRID",
      minRemoteDays: 2,
      contractTypes: ["CDI"],
      locations: [{ label: "Paris", radiusKm: 30 }],
    },
    showSalary: true,
    showLocations: true,
    allowProofUrls: false,
    ...overrides,
  });
}

const codes = (c: CardContent, terms: string[] = []) =>
  checkCard(c, { terms }).map((i) => `${i.code}@${i.path}`);

describe("contrôle de ré-identification", () => {
  it("accepte une carte anonyme (cas négatif)", () => {
    expect(checkCard(card(), { terms: ["Testard", "Globex"] })).toEqual([]);
    // Durées, pourcentages et volumes ne sont pas des dates.
    for (const text of [
      "6 ans d'expérience en data",
      "2000 utilisateurs actifs, +45 % de conversion",
      "Migration vers Kubernetes et Node.js, licence MIT",
      "Équipe de 12 personnes, budget de 1,2 M€",
      "Backend ASP.NET et Socket.IO, déploiement continu",
    ]) {
      expect(checkText(text, "x", { terms: [] }), text).toEqual([]);
    }
  });

  it("repère coordonnées et liens dans les textes", () => {
    expect(codes(card({ headline: "Data engineer — jeanne@exemple.fr" }))).toContain(
      "contact@headline",
    );
    expect(codes(card({ headline: "Data engineer, 06 12 34 56 78" }))).toContain(
      "contact@headline",
    );
    const withUrl = card();
    withUrl.achievements[0]!.result = "Voir https://jeanne-dev.fr/portfolio";
    expect(codes(withUrl)).toContain("url@achievements.0.result");
    withUrl.achievements[0]!.result = "Démo sur monportfolio.fr";
    expect(codes(withUrl)).toContain("url@achievements.0.result");
  });

  it("repère les employeurs (« chez », « at », forme juridique) et les termes connus", () => {
    expect(codes(card({ headline: "Data engineer chez Qonto" }))).toContain("employer@headline");
    expect(codes(card({ headline: "Data engineer at Doctolib" }))).toContain("employer@headline");
    const legal = card();
    legal.achievements[0]!.title = "Migration du SI de Globex Industries SAS";
    expect(codes(legal)).toContain("employer@achievements.0.title");
    // Entreprise exclue / connue du radar, sans casse ni accents.
    const known = card();
    known.achievements[0]!.result = "Adopté par toute l'équipe de dataiku";
    expect(codes(known, ["Dataiku"])).toContain("knownTerm@achievements.0.result");
    expect(findTerm("La Société Générale", ["societe generale"])).toBe("Société Générale");
    // Mot entier seulement : « Alan » ne bloque pas « Alanine ».
    expect(findTerm("Analyse de l'alanine", ["Alan"])).toBeNull();
  });

  it("repère les écoles", () => {
    expect(codes(card({ headline: "Ingénieur diplômé de l'École Centrale" }))).toContain(
      "school@headline",
    );
    expect(codes(card({ headline: "MBA HEC, ex-consultant" }))).toContain("school@headline");
    expect(codes(card({ headline: "Alumni Universität Wien" }))).toContain("school@headline");
  });

  it("repère les dates exactes (intitulé rare + dates = ré-identifiable)", () => {
    for (const text of [
      "Lead data depuis mars 2021",
      "Head of Growth (03/2019 – 06/2023)",
      "Arrivée le 12/03/2021",
      "Poste occupé 2018-2022",
      "Lancement Q3 2024",
      "CTO since 2020",
    ]) {
      expect(
        checkText(text, "x", { terms: [] }).map((i) => i.code),
        text,
      ).toContain("date");
    }
  });

  it("refuse les liens de preuve identifiants, et tous les liens s'ils ne sont pas autorisés", () => {
    const proofs = card({ allowProofUrls: true });
    proofs.achievements[0]!.proofUrls = [
      "https://www.linkedin.com/in/jeanne-testard",
      "https://github.com/jtestard",
      "https://github.com/acme/pipeline",
    ];
    expect(codes(proofs, ["jtestard"])).toEqual([
      "identityUrl@achievements.0.proofUrls.0",
      "identityUrl@achievements.0.proofUrls.1",
    ]);
    proofs.achievements[0]!.proofUrls = ["https://github.com/jtestard/pipeline"];
    expect(codes(proofs, ["jtestard"])).toEqual(["knownTerm@achievements.0.proofUrls.0"]);
    // Non autorisés : jamais montrés, donc jamais contrôlés ni partagés.
    proofs.allowProofUrls = false;
    expect(codes(proofs, ["jtestard"])).toEqual([]);
    expect(publicCard(proofs).achievements[0]!.proofUrls).toEqual([]);
  });

  it("exige une accroche et ne contrôle que ce qui est montré", () => {
    expect(codes(card({ headline: "" }))).toEqual(["headlineMissing@headline"]);
    const hidden = card({ showLocations: false });
    hidden.rails.locations = [{ label: "Testardville", radiusKm: 10 }];
    expect(codes(hidden, ["Testardville"])).toEqual([]);
    expect(codes({ ...hidden, showLocations: true }, ["Testardville"])).toEqual([
      "knownTerm@rails.locations.0",
    ]);
  });

  it("utilise les termes du coffre (navigateur) : nom, employeurs, écoles, liens", () => {
    const terms = vaultTerms({
      firstName: "Jeanne",
      lastName: "Testard",
      email: "jeanne.t@exemple.fr",
      employers: [{ name: "Initech" }],
      schools: [{ name: "Institut Fictif" }],
      links: [{ url: "https://github.com/jtestard" }],
    });
    expect(terms).toEqual(
      expect.arrayContaining(["Jeanne Testard", "Initech", "Institut Fictif", "jtestard"]),
    );
    const c = card();
    c.achievements[0]!.result = "Repris ensuite par Initech";
    expect(codes(c, terms)).toContain("knownTerm@achievements.0.result");
  });
});

describe("génération de la carte", () => {
  const source = {
    experiences: [
      {
        roleTitle: "Data engineer",
        seniority: "MID" as const,
        startMonth: month("2016-01"),
        endMonth: month("2019-12"),
      },
      {
        roleTitle: "Lead data engineer",
        seniority: "LEAD" as const,
        startMonth: month("2019-06"),
        endMonth: null,
      },
    ],
    achievements: [
      {
        title: "Veille technologique",
        result: "",
        evidenceLevel: "DECLARED" as const,
        skills: ["Rust"],
        proofUrls: [],
      },
      {
        title: "Pipeline temps réel pour Globex",
        result: "Latence divisée par 10 — contact : jeanne@exemple.fr",
        evidenceLevel: "DOCUMENT" as const,
        skills: ["Kafka", "Python"],
        proofUrls: ["https://www.linkedin.com/in/jeanne", "https://github.com/acme/rt"],
      },
      {
        title: "Tableau de bord qualité",
        result: "98 % des alertes traitées en moins d'une heure",
        evidenceLevel: "DECLARED" as const,
        skills: ["Python", "dbt"],
        proofUrls: [],
      },
    ],
    rails: {
      minFixedSalary: 61_400,
      remotePolicy: "HYBRID" as const,
      minRemoteDays: 2,
      contractTypes: ["CDI" as const],
      locations: [{ label: "Lyon", radiusKm: 20 }],
    },
    knownTerms: ["Globex"],
  };

  it("part de la mémoire pseudonymisée : accroche, réalisations prouvées puis chiffrées", () => {
    const built = buildCard(source, NOW);
    expect(cardSchema.parse(built)).toEqual(built);
    expect(built.headline).toBe("Lead data engineer");
    expect(built.seniority).toBe("LEAD");
    expect(built.yearsOfExperience).toBe(10);
    expect(built.achievements.map((a) => a.title)).toEqual([
      "Pipeline temps réel pour […]",
      "Tableau de bord qualité",
      "Veille technologique",
    ]);
    // Coordonnées retirées, liens de profil écartés.
    expect(built.achievements[0]!.result).not.toMatch(/@/);
    expect(built.achievements[0]!.proofUrls).toEqual(["https://github.com/acme/rt"]);
    expect(built.allowProofUrls).toBe(false);
    expect(built.skills).toEqual([
      { name: "Kafka", proven: true },
      { name: "Python", proven: true },
      { name: "Rust", proven: false },
      { name: "dbt", proven: false },
    ]);
    expect(built.rails).toMatchObject({ salaryFloor: 61_000, remotePolicy: "HYBRID" });
    expect(checkCard(built, { terms: source.knownTerms })).toEqual([]);
  });

  it("compte les années d'expérience sans doubler les chevauchements", () => {
    expect(yearsOfExperience([], NOW)).toBeNull();
    expect(
      yearsOfExperience(
        [
          { startMonth: month("2020-01"), endMonth: month("2021-12") },
          { startMonth: month("2021-01"), endMonth: month("2022-12") },
        ],
        NOW,
      ),
    ).toBe(3);
  });
});

describe("jetons des liens publics", () => {
  it("sont aléatoires, au bon format, et seule leur empreinte est stockée", () => {
    const a = newToken();
    const b = newToken();
    expect(isTokenShape(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
    expect(isTokenShape("abc")).toBe(false);
    expect(isTokenShape({ not: "x" })).toBe(false);
  });

  it("expirent et se révoquent", () => {
    const expiresAt = linkExpiry(NOW, 30);
    expect(isLinkActive({ expiresAt, revokedAt: null }, NOW)).toBe(true);
    expect(isLinkActive({ expiresAt, revokedAt: null }, new Date(expiresAt.getTime() + 1))).toBe(
      false,
    );
    expect(isLinkActive({ expiresAt, revokedAt: NOW }, NOW)).toBe(false);
    expect(cardLinkTtlDays({})).toBe(30);
    expect(cardLinkTtlDays({ CARD_LINK_TTL_DAYS: "7" })).toBe(7);
    expect(cardLinkTtlDays({ CARD_LINK_TTL_DAYS: "0" })).toBe(30);
  });
});
