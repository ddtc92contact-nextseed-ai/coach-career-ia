import { describe, expect, it } from "vitest";
import {
  checkGuardRails,
  contractTypeRule,
  excludedCompanyRule,
  excludedSectorRule,
  locationRule,
  onCallRule,
  remoteOutsideZoneAccepted,
  remoteDaysRule,
  remotePolicyRule,
  RULES,
  salaryFloorRule,
  weeklyHoursRule,
} from "@/lib/matching/filters";
import { annualSalary } from "@/lib/matching/salary";
import { mapGreenhouseJob, type GreenhouseJob } from "@/lib/radar/connectors/greenhouse";
import { explanationFacts, factLines } from "@/lib/matching/explanation";
import { rankOffers } from "@/lib/matching/score";
import { mentionsTravel, travelDestination } from "@/lib/matching/signals";
import type { CandidateProfile, CandidateRails, MatchOffer } from "@/lib/matching/types";
import { VIOLATION_CODES } from "@/lib/matching/types";
import { EXOTEC_LEAD_SOLUTIONS_ENGINEER } from "../fixtures/matching/exotec";
import { company, fixtureJson } from "../helpers/radar";

const PARIS = { latitude: 48.8566, longitude: 2.3522 };

const RAILS: CandidateRails = {
  minFixedSalary: null,
  targetTotalPackage: null,
  remotePolicy: null,
  minRemoteDays: null,
  contractTypes: [],
  excludedSectors: [],
  excludedCompanies: [],
  maxWeeklyHours: null,
  acceptsOnCall: true,
  acceptsRemoteOutsideZone: false,
  culturePreferences: [],
  locations: [],
};

function offer(overrides: Partial<MatchOffer> = {}): MatchOffer {
  return {
    id: "o1",
    title: "Data Engineer",
    description: "Python et SQL.",
    companyName: "Exemple",
    sector: "Logiciel",
    seniority: null,
    contractLabel: null,
    ...PARIS,
    remotePolicy: "HYBRID",
    contractType: "CDI",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    ...overrides,
  };
}

const rails = (overrides: Partial<CandidateRails>): CandidateRails => ({ ...RAILS, ...overrides });

describe("salaire plancher", () => {
  const floor = rails({ minFixedSalary: 50000 });
  it("exclut une fourchette annualisée entièrement sous le plancher", () => {
    const low = offer({
      salaryMin: 40000,
      salaryMax: 45000,
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
    });
    expect(salaryFloorRule(low, floor)).toEqual({ violation: "salaryBelowFloor" });
  });
  it("garde une fourchette dont le haut atteint le plancher", () => {
    const range = offer({
      salaryMin: 45000,
      salaryMax: 55000,
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
    });
    expect(salaryFloorRule(range, floor)).toEqual({});
  });
  it("annualise les salaires mensuels, journaliers et horaires", () => {
    expect(
      annualSalary({
        salaryMin: 4000,
        salaryMax: 4500,
        salaryCurrency: "EUR",
        salaryPeriod: "MONTH",
      }),
    ).toEqual({ min: 48000, max: 54000 });
    expect(
      annualSalary({ salaryMin: 500, salaryMax: null, salaryCurrency: "EUR", salaryPeriod: "DAY" }),
    ).toEqual({ min: 109000, max: 109000 });
    expect(
      annualSalary({
        salaryMin: 11.88,
        salaryMax: null,
        salaryCurrency: "EUR",
        salaryPeriod: "HOUR",
      }),
    ).toEqual({ min: 19091, max: 19091 });
    const monthly = offer({
      salaryMin: 3500,
      salaryMax: 4000,
      salaryCurrency: "EUR",
      salaryPeriod: "MONTH",
    });
    expect(salaryFloorRule(monthly, floor)).toEqual({ violation: "salaryBelowFloor" });
  });
  it("n'exclut PAS une offre sans salaire : elle est signalée", () => {
    expect(salaryFloorRule(offer(), floor)).toEqual({ unknown: "salaryNotStated" });
  });
  it("ne compare pas une autre devise (signalée, jamais estimée)", () => {
    const usd = offer({
      salaryMin: 30000,
      salaryMax: 35000,
      salaryCurrency: "USD",
      salaryPeriod: "YEAR",
    });
    expect(salaryFloorRule(usd, floor)).toEqual({ unknown: "salaryNotStated" });
  });
  it("sans période, seul un montant manifestement annuel compte", () => {
    expect(
      annualSalary({ salaryMin: 3000, salaryMax: null, salaryCurrency: "EUR", salaryPeriod: null }),
    ).toBeNull();
    expect(
      annualSalary({
        salaryMin: 52000,
        salaryMax: null,
        salaryCurrency: "EUR",
        salaryPeriod: null,
      }),
    ).toEqual({ min: 52000, max: 52000 });
  });
});

describe("politique de télétravail", () => {
  it("full remote exige une offre en télétravail complet", () => {
    const r = rails({ remotePolicy: "FULL_REMOTE" });
    expect(remotePolicyRule(offer({ remotePolicy: "HYBRID" }), r)).toEqual({
      violation: "remotePolicy",
    });
    expect(remotePolicyRule(offer({ remotePolicy: "ONSITE" }), r)).toEqual({
      violation: "remotePolicy",
    });
    expect(remotePolicyRule(offer({ remotePolicy: "FULL_REMOTE" }), r)).toEqual({});
  });
  it("hybride refuse le 100 % sur site", () => {
    const r = rails({ remotePolicy: "HYBRID" });
    expect(remotePolicyRule(offer({ remotePolicy: "ONSITE" }), r)).toEqual({
      violation: "remotePolicy",
    });
    expect(remotePolicyRule(offer({ remotePolicy: "FULL_REMOTE" }), r)).toEqual({});
  });
  it("présentiel accepté : tout passe ; politique inconnue : signalée", () => {
    expect(
      remotePolicyRule(offer({ remotePolicy: "ONSITE" }), rails({ remotePolicy: "ONSITE" })),
    ).toEqual({});
    expect(
      remotePolicyRule(offer({ remotePolicy: "UNKNOWN" }), rails({ remotePolicy: "HYBRID" })),
    ).toEqual({ unknown: "remoteNotStated" });
  });
});

describe("jours de télétravail minimum", () => {
  const r = rails({ minRemoteDays: 2 });
  it("exclut une offre qui annonce moins de jours", () => {
    expect(remoteDaysRule(offer({ description: "Télétravail : 1 jour par semaine." }), r)).toEqual({
      violation: "remoteDays",
    });
    expect(remoteDaysRule(offer({ description: "1 day remote per week" }), r)).toEqual({
      violation: "remoteDays",
    });
  });
  it("garde une offre qui annonce assez de jours ou le full remote", () => {
    expect(remoteDaysRule(offer({ description: "2 jours de télétravail par semaine" }), r)).toEqual(
      {},
    );
    expect(remoteDaysRule(offer({ description: "télétravail jusqu'à 3 jours" }), r)).toEqual({});
    expect(remoteDaysRule(offer({ remotePolicy: "FULL_REMOTE" }), r)).toEqual({});
  });
  it("exclut le 100 % sur site ; nombre de jours non précisé : signalé", () => {
    expect(remoteDaysRule(offer({ remotePolicy: "ONSITE" }), r)).toEqual({
      violation: "remoteDays",
    });
    expect(remoteDaysRule(offer({ description: "Télétravail possible." }), r)).toEqual({
      unknown: "remoteDaysNotStated",
    });
  });
});

describe("zone géographique", () => {
  const r = rails({ locations: [{ ...PARIS, radiusKm: 30 }] });
  it("exclut une offre hors rayon ou sans coordonnées", () => {
    expect(locationRule(offer({ latitude: 45.764, longitude: 4.8357 }), r)).toEqual({
      violation: "outsideRadius",
    });
    expect(locationRule(offer({ latitude: null, longitude: null }), r)).toEqual({
      violation: "outsideRadius",
    });
  });
  it("garde une offre dans le rayon ; en télétravail complet ailleurs, seulement avec accord", () => {
    expect(locationRule(offer({ latitude: 48.8919, longitude: 2.2383 }), r)).toEqual({});
    const lyonRemote = offer({ latitude: 45.764, longitude: 4.8357, remotePolicy: "FULL_REMOTE" });
    expect(locationRule(lyonRemote, r)).toEqual({ violation: "outsideRadius" });
    expect(locationRule(lyonRemote, { ...r, acceptsRemoteOutsideZone: true })).toEqual({});
  });
  it("lieux du candidat non localisés : filtre impossible, signalé", () => {
    const unlocated = rails({ locations: [{ latitude: null, longitude: null, radiusKm: 20 }] });
    expect(locationRule(offer(), unlocated)).toEqual({ unknown: "locationNotChecked" });
  });
  it("garde-fou en Alsace : l'offre de Nantes dont seule la rubrique « pas pour vous » parle de télétravail est exclue", () => {
    // Deux communes d'Alsace, 30 km, sans préférence de télétravail.
    const alsace = rails({
      locations: [
        { latitude: 48.5734, longitude: 7.7521, radiusKm: 30 },
        { latitude: 48.0794, longitude: 7.3585, radiusKm: 30 },
      ],
    });
    const [job] = fixtureJson<{ jobs: GreenhouseJob[] }>("greenhouse-doctolib.json").jobs;
    const mapped = mapGreenhouseJob(
      job!,
      company({ slug: "doctolib", name: "Doctolib", boardToken: "doctolib" }),
    )!;
    const nantes = offer({
      title: mapped.title,
      description: mapped.description,
      companyName: mapped.companyName,
      remotePolicy: mapped.remotePolicy,
      latitude: 47.2184,
      longitude: -1.5536,
    });
    expect(mapped.location.city).toBe("Nantes");
    expect(checkGuardRails(nantes, alsace)).toMatchObject({
      pass: false,
      violations: ["outsideRadius"],
    });
    // Même en télétravail complet, elle reste hors zone sans l'accord du candidat.
    expect(checkGuardRails({ ...nantes, remotePolicy: "FULL_REMOTE" }, alsace).pass).toBe(false);
  });
});

describe("télétravail complet hors zone : sur accord du candidat (#66)", () => {
  const STRASBOURG = { latitude: 48.5734, longitude: 7.7521 };
  const LILLE = { latitude: 50.6292, longitude: 3.0573 };
  const alsace = rails({ locations: [{ ...STRASBOURG, radiusKm: 30 }] });
  const agreed = { ...alsace, acceptsRemoteOutsideZone: true };
  const lilleRemote = offer({ ...LILLE, remotePolicy: "FULL_REMOTE" });
  const noCityRemote = offer({ latitude: null, longitude: null, remotePolicy: "FULL_REMOTE" });

  it("candidat en Alsace (30 km), offre FULL_REMOTE à Lille : exclue sans accord, incluse avec", () => {
    expect(locationRule(lilleRemote, alsace)).toEqual({ violation: "outsideRadius" });
    expect(checkGuardRails(lilleRemote, alsace)).toMatchObject({
      pass: false,
      violations: ["outsideRadius"],
    });
    expect(locationRule(lilleRemote, agreed)).toEqual({});
    expect(checkGuardRails(lilleRemote, agreed).pass).toBe(true);
  });

  it("offre FULL_REMOTE sans ville : exclue sans accord, incluse avec", () => {
    expect(locationRule(noCityRemote, alsace)).toEqual({ violation: "outsideRadius" });
    expect(locationRule(noCityRemote, agreed)).toEqual({});
  });

  it("offre dans le rayon : incluse, en télétravail complet ou sur site, sans accord", () => {
    const colmar = { latitude: 48.4, longitude: 7.65 }; // ~20 km de Strasbourg
    for (const remotePolicy of ["ONSITE", "HYBRID", "FULL_REMOTE", "UNKNOWN"] as const) {
      expect(locationRule(offer({ ...colmar, remotePolicy }), alsace), remotePolicy).toEqual({});
    }
    expect(locationRule(offer({ ...STRASBOURG, remotePolicy: "ONSITE" }), alsace)).toEqual({});
  });

  it("l'accord ne concerne que le télétravail complet : une offre sur site hors zone reste exclue", () => {
    for (const remotePolicy of ["ONSITE", "HYBRID", "UNKNOWN"] as const) {
      expect(locationRule(offer({ ...LILLE, remotePolicy }), agreed), remotePolicy).toEqual({
        violation: "outsideRadius",
      });
    }
  });

  it("candidat sans lieu : inchangé, tout passe", () => {
    const anywhere = rails({ locations: [] });
    expect(locationRule(lilleRemote, anywhere)).toEqual({});
    expect(locationRule(noCityRemote, anywhere)).toEqual({});
    expect(locationRule(offer({ ...LILLE, remotePolicy: "ONSITE" }), anywhere)).toEqual({});
  });

  it("candidat qui ne veut que du télétravail complet : l'accord est implicite", () => {
    const remoteOnly = { ...alsace, remotePolicy: "FULL_REMOTE" as const };
    expect(remoteOutsideZoneAccepted(remoteOnly)).toBe(true);
    expect(locationRule(lilleRemote, remoteOnly)).toEqual({});
    expect(locationRule(noCityRemote, remoteOnly)).toEqual({});
    expect(checkGuardRails(lilleRemote, remoteOnly).pass).toBe(true);
    expect(remoteOutsideZoneAccepted(alsace)).toBe(false);
    expect(remoteOutsideZoneAccepted({ ...alsace, remotePolicy: "HYBRID" })).toBe(false);
  });

  it("lieux non localisés : sans accord, le filtre reste impossible (signalé) ; avec, l'offre passe", () => {
    const unlocated = rails({ locations: [{ latitude: null, longitude: null, radiusKm: 30 }] });
    expect(locationRule(lilleRemote, unlocated)).toEqual({ unknown: "locationNotChecked" });
    expect(locationRule(lilleRemote, { ...unlocated, acceptsRemoteOutsideZone: true })).toEqual({});
  });
});

describe("types de contrat", () => {
  const r = rails({ contractTypes: ["CDI"] });
  it("exclut un contrat non accepté (y compris « autre »)", () => {
    expect(contractTypeRule(offer({ contractType: "CDD" }), r)).toEqual({
      violation: "contractType",
    });
    expect(contractTypeRule(offer({ contractType: "OTHER" }), r)).toEqual({
      violation: "contractType",
    });
  });
  it("garde un contrat accepté ; contrat non précisé : signalé", () => {
    expect(contractTypeRule(offer({ contractType: "CDI" }), r)).toEqual({});
    expect(contractTypeRule(offer({ contractType: "UNKNOWN" }), r)).toEqual({
      unknown: "contractNotStated",
    });
  });
});

describe("secteurs exclus", () => {
  const r = rails({ excludedSectors: ["GAMBLING", "TOBACCO_ALCOHOL"] });
  it("exclut d'après le secteur déclaré de l'offre", () => {
    expect(excludedSectorRule(offer({ sector: "Paris sportifs en ligne" }), r)).toEqual({
      violation: "excludedSector",
    });
    expect(excludedSectorRule(offer({ sector: "Casinos & jeux" }), r)).toEqual({
      violation: "excludedSector",
    });
    expect(excludedSectorRule(offer({ sector: "Vins et spiritueux" }), r)).toEqual({
      violation: "excludedSector",
    });
  });
  it("ne déduit pas le secteur de la description", () => {
    const o = offer({
      sector: "Logiciel",
      description: "Nos clients : casinos, banques, assureurs.",
    });
    expect(excludedSectorRule(o, r)).toEqual({});
  });
});

describe("entreprises exclues", () => {
  const r = rails({ excludedCompanies: ["Globex", "Société Générale"] });
  it("compare des noms normalisés (casse, accents, forme juridique)", () => {
    expect(excludedCompanyRule(offer({ companyName: "GLOBEX Corporation SAS" }), r)).toEqual({
      violation: "excludedCompany",
    });
    expect(excludedCompanyRule(offer({ companyName: "societe generale" }), r)).toEqual({
      violation: "excludedCompany",
    });
    expect(
      excludedCompanyRule(offer({ companyName: "Groupe Société Générale France" }), r),
    ).toEqual({ violation: "excludedCompany" });
  });
  it("ne confond pas des noms seulement proches", () => {
    expect(excludedCompanyRule(offer({ companyName: "Globexia" }), r)).toEqual({});
    expect(excludedCompanyRule(offer({ companyName: "Générale d'Optique" }), r)).toEqual({});
    expect(excludedCompanyRule(offer({ companyName: null }), r)).toEqual({});
  });
});

describe("durée hebdomadaire", () => {
  const r = rails({ maxWeeklyHours: 39 });
  it("exclut une durée annoncée supérieure au maximum", () => {
    expect(weeklyHoursRule(offer({ description: "Horaires : 42h/semaine." }), r)).toEqual({
      violation: "weeklyHours",
    });
    expect(weeklyHoursRule(offer({ contractLabel: "45H Horaires normaux" }), r)).toEqual({
      violation: "weeklyHours",
    });
    expect(weeklyHoursRule(offer({ description: "40 hours per week" }), r)).toEqual({
      violation: "weeklyHours",
    });
  });
  it("garde une durée compatible ; durée non précisée : signalée", () => {
    expect(weeklyHoursRule(offer({ description: "35 heures hebdomadaires" }), r)).toEqual({});
    expect(weeklyHoursRule(offer({ description: "Horaires flexibles" }), r)).toEqual({
      unknown: "hoursNotStated",
    });
  });
});

describe("astreintes", () => {
  const refuses = rails({ acceptsOnCall: false });
  it("exclut une offre avec astreintes si le candidat les refuse", () => {
    expect(
      onCallRule(offer({ description: "Astreintes un week-end sur quatre." }), refuses),
    ).toEqual({ violation: "onCall" });
    expect(onCallRule(offer({ description: "On-call rotation every 6 weeks." }), refuses)).toEqual({
      violation: "onCall",
    });
  });
  it("comprend la négation, et n'exclut rien si le candidat les accepte", () => {
    expect(onCallRule(offer({ description: "Pas d'astreinte, jamais." }), refuses)).toEqual({});
    expect(onCallRule(offer({ description: "Sans astreinte." }), refuses)).toEqual({});
    expect(onCallRule(offer({ description: "No on-call duty." }), refuses)).toEqual({});
    expect(
      onCallRule(offer({ description: "Astreintes." }), rails({ acceptsOnCall: true })),
    ).toEqual({});
  });
});

describe("déplacements mentionnés par une offre en télétravail complet (#66)", () => {
  it("reconnaît les déplacements réguliers, en français et en anglais", () => {
    for (const text of [
      EXOTEC_LEAD_SOLUTIONS_ENGINEER.description,
      "Déplacements fréquents à prévoir en France.",
      "Des déplacements sont à prévoir chez nos clients.",
      "Vous viendrez deux fois par mois au siège à Lille.",
      "Présence au bureau de Lyon une fois par mois.",
      "Travel to our headquarters in Paris once a quarter.",
      "Up to 30 % travel.",
      "Regular travel to customer sites across Europe.",
      "Willingness to travel occasionally.",
    ]) {
      expect(mentionsTravel(text), text).toBe(true);
    }
  });

  it("ignore les mentions négatives et les faux amis", () => {
    for (const text of [
      "Pas de déplacement.",
      "100 % télétravail, aucun déplacement à prévoir.",
      "Sans déplacements.",
      "No travel required.",
      "No need to travel to the office.",
      "Frais de déplacement remboursés. Télétravail complet.",
      "Visit our website to learn more. Remote-first company.",
      "Télétravail 2 jours par semaine.",
    ]) {
      expect(mentionsTravel(text), text).toBe(false);
    }
  });

  it("donne la ville du siège ou du bureau quand elle est écrite simplement", () => {
    expect(travelDestination(EXOTEC_LEAD_SOLUTIONS_ENGINEER.description)).toBe("Lille");
    expect(travelDestination("Présence au bureau de Lyon une fois par mois.")).toBe("Lyon");
    expect(travelDestination("Travel to our headquarters in Paris once a quarter.")).toBe("Paris");
    expect(travelDestination("Déplacements fréquents à prévoir en France.")).toBeNull();
    expect(travelDestination("Up to 30 % travel.")).toBeNull();
  });

  const profile: CandidateProfile = {
    seniority: "LEAD",
    achievements: [],
    skills: [{ name: "Python", proven: true }],
  };
  const exotec = offer({
    ...EXOTEC_LEAD_SOLUTIONS_ENGINEER,
    remotePolicy: "FULL_REMOTE",
  });
  const agreed = rails({
    locations: [{ latitude: 48.5734, longitude: 7.7521, radiusKm: 30 }],
    acceptsRemoteOutsideZone: true,
  });

  it("signal, pas un filtre : l'offre Exotec passe avec l'accord, signalée avec la ville", () => {
    const [match] = rankOffers(profile, agreed, [exotec], null).matches;
    expect(match).toMatchObject({ offerId: exotec.id, travelPlace: "Lille" });
    expect(match!.unknowns).toContain("remoteWithTravel");
    const lines = factLines(explanationFacts(match!), "fr");
    expect(lines.unknowns).toContain(
      "Télétravail complet, mais l’offre mentionne des déplacements (Lille) : à vérifier.",
    );
    // Sans accord : hors zone, l'offre n'est pas proposée.
    expect(
      rankOffers(profile, { ...agreed, acceptsRemoteOutsideZone: false }, [exotec], null),
    ).toMatchObject({ matches: [], excluded: [{ violations: ["outsideRadius"] }] });
  });

  it("ne signale rien sur une offre qui n'est pas en télétravail complet", () => {
    const hybrid = offer({ ...EXOTEC_LEAD_SOLUTIONS_ENGINEER, ...PARIS, remotePolicy: "HYBRID" });
    const [match] = rankOffers(profile, RAILS, [hybrid], null).matches;
    expect(match!.unknowns).not.toContain("remoteWithTravel");
    expect(match).not.toHaveProperty("travelPlace");
  });
});

describe("un garde-fou violé n'apparaît jamais, quel que soit le score", () => {
  // Profil qui correspond parfaitement à l'offre : score maximal sans les garde-fous.
  const profile: CandidateProfile = {
    seniority: "SENIOR",
    achievements: [
      {
        id: "a1",
        title: "Pipelines",
        text: "Python SQL",
        evidenceLevel: "VERIFIED",
        skills: ["Python", "SQL"],
      },
    ],
    skills: [
      { name: "Python", proven: true },
      { name: "SQL", proven: true },
      { name: "Airflow", proven: true },
    ],
  };
  const perfect = offer({
    title: "Senior Data Engineer",
    description:
      "Python, SQL et Airflow. Culture asynchrone. 2 jours de télétravail par semaine. 35 heures hebdomadaires.",
    salaryMin: 90000,
    salaryMax: 100000,
    salaryCurrency: "EUR",
    salaryPeriod: "YEAR",
  });
  const violations: Record<
    (typeof VIOLATION_CODES)[number],
    [Partial<MatchOffer>, Partial<CandidateRails>]
  > = {
    salaryBelowFloor: [{}, { minFixedSalary: 120000 }],
    remotePolicy: [{}, { remotePolicy: "FULL_REMOTE" }],
    remoteDays: [{}, { minRemoteDays: 3 }],
    outsideRadius: [
      { latitude: 45.764, longitude: 4.8357 },
      { locations: [{ ...PARIS, radiusKm: 10 }] },
    ],
    contractType: [{ contractType: "FREELANCE" }, { contractTypes: ["CDI"] }],
    excludedSector: [{ sector: "Casino en ligne" }, { excludedSectors: ["GAMBLING"] }],
    excludedCompany: [{ companyName: "Initech SA" }, { excludedCompanies: ["initech"] }],
    weeklyHours: [{}, { maxWeeklyHours: 32 }],
    onCall: [{ description: `${perfect.description} Astreintes.` }, { acceptsOnCall: false }],
  };

  it("couvre toutes les règles", () => {
    expect(Object.keys(violations).sort()).toEqual([...VIOLATION_CODES].sort());
    expect(Object.keys(RULES).sort()).toEqual([...VIOLATION_CODES].sort());
  });

  it("sans garde-fou, l'offre parfaite a un score élevé", () => {
    const { matches } = rankOffers(profile, RAILS, [perfect], null);
    expect(matches[0]!.score).toBeGreaterThanOrEqual(80);
  });

  for (const [code, [offerPatch, railsPatch]] of Object.entries(violations)) {
    it(`règle « ${code} » : l'offre est exclue malgré son score`, () => {
      const violating = { ...perfect, ...offerPatch };
      const r = rails(railsPatch);
      expect(checkGuardRails(violating, r).violations).toContain(code);
      const { matches, excluded } = rankOffers(
        profile,
        r,
        [violating],
        new Map([["o1", new Map([["a1", 1]])]]),
      );
      expect(matches).toEqual([]);
      expect(excluded).toEqual([
        { offerId: "o1", pass: false, violations: expect.arrayContaining([code]) },
      ]);
    });
  }
});
