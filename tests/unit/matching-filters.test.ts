import { describe, expect, it } from "vitest";
import {
  checkGuardRails,
  contractTypeRule,
  excludedCompanyRule,
  excludedSectorRule,
  locationRule,
  onCallRule,
  remoteDaysRule,
  remotePolicyRule,
  RULES,
  salaryFloorRule,
  weeklyHoursRule,
} from "@/lib/matching/filters";
import { annualSalary } from "@/lib/matching/salary";
import { rankOffers } from "@/lib/matching/score";
import type { CandidateProfile, CandidateRails, MatchOffer } from "@/lib/matching/types";
import { VIOLATION_CODES } from "@/lib/matching/types";

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
  it("garde une offre dans le rayon, ou en télétravail complet où qu'elle soit", () => {
    expect(locationRule(offer({ latitude: 48.8919, longitude: 2.2383 }), r)).toEqual({});
    expect(
      locationRule(offer({ latitude: 45.764, longitude: 4.8357, remotePolicy: "FULL_REMOTE" }), r),
    ).toEqual({});
  });
  it("lieux du candidat non localisés : filtre impossible, signalé", () => {
    const unlocated = rails({ locations: [{ latitude: null, longitude: null, radiusKm: 20 }] });
    expect(locationRule(offer(), unlocated)).toEqual({ unknown: "locationNotChecked" });
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
