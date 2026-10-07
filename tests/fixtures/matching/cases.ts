/**
 * Jeu de référence du matching : profils et offres FICTIFS, avec le résultat
 * attendu (offres exclues et pourquoi, ordre des meilleures offres). Sert à
 * comparer règles, prompts et modèles : `tests/unit/matching-ranking.test.ts`.
 * Aucune donnée réelle ; entreprises et réalisations sont inventées.
 */
import type {
  CandidateProfile,
  CandidateRails,
  MatchOffer,
  UnknownCode,
  ViolationCode,
} from "@/lib/matching/types";

const PARIS = { latitude: 48.8566, longitude: 2.3522 };
const LA_DEFENSE = { latitude: 48.8919, longitude: 2.2383 };
const LYON = { latitude: 45.764, longitude: 4.8357 };

function offer(id: string, overrides: Partial<MatchOffer>): MatchOffer {
  return {
    id,
    title: "Poste",
    description: "",
    companyName: "Entreprise Exemple",
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

const DATA_STACK =
  "Vous construirez nos pipelines de données en Python et SQL, orchestrés avec Airflow, et modéliserez l’entrepôt avec dbt.";
const HYBRID_2 = "Télétravail : 2 jours par semaine.";

export const OFFERS: MatchOffer[] = [
  offer("de-great", {
    title: "Senior Data Engineer",
    companyName: "Datafleur",
    description: `${DATA_STACK}\n${HYBRID_2}\nCulture asynchrone, budget formation annuel et conférences.`,
    salaryMin: 60000,
    salaryMax: 75000,
    salaryCurrency: "EUR",
    salaryPeriod: "YEAR",
  }),
  offer("de-no-salary", {
    title: "Data Engineer",
    companyName: "Nuagique",
    ...LA_DEFENSE,
    description: "Pipelines Python et Spark sur notre plateforme cloud. Télétravail 3 jours par semaine. Pas d'astreinte.",
  }),
  offer("de-low-salary", {
    title: "Data Engineer",
    description: `${DATA_STACK}\n${HYBRID_2}`,
    salaryMin: 40000,
    salaryMax: 45000,
    salaryCurrency: "EUR",
    salaryPeriod: "YEAR",
  }),
  offer("de-monthly-ok", {
    title: "Data Engineer confirmé",
    description: `${DATA_STACK}\n${HYBRID_2}`,
    salaryMin: 4800,
    salaryMax: 5200,
    salaryCurrency: "EUR",
    salaryPeriod: "MONTH",
  }),
  offer("de-freelance", {
    title: "Data Engineer freelance",
    contractType: "FREELANCE",
    description: `${DATA_STACK}\n${HYBRID_2}`,
    salaryMin: 550,
    salaryMax: 550,
    salaryCurrency: "EUR",
    salaryPeriod: "DAY",
  }),
  offer("de-lyon", { title: "Data Engineer", ...LYON, description: `${DATA_STACK}\n${HYBRID_2}` }),
  offer("de-remote-lyon", {
    title: "Data Engineer (full remote)",
    ...LYON,
    remotePolicy: "FULL_REMOTE",
    description: DATA_STACK,
  }),
  offer("de-unlocated", {
    title: "Data Engineer",
    latitude: null,
    longitude: null,
    description: `${DATA_STACK}\n${HYBRID_2}`,
  }),
  offer("de-onsite", {
    title: "Data Engineer",
    remotePolicy: "ONSITE",
    description: DATA_STACK,
  }),
  offer("de-one-day", {
    title: "Data Engineer",
    description: `${DATA_STACK}\nTélétravail : 1 jour par semaine.`,
  }),
  offer("de-gambling", {
    title: "Data Engineer",
    sector: "Paris sportifs en ligne",
    description: `${DATA_STACK}\n${HYBRID_2}`,
  }),
  offer("de-globex", {
    title: "Data Engineer",
    companyName: "GLOBEX Corporation SAS",
    description: `${DATA_STACK}\n${HYBRID_2}`,
  }),
  offer("de-hours", {
    title: "Data Engineer",
    description: `${DATA_STACK}\n${HYBRID_2}\nHoraires : 42h/semaine.`,
  }),
  offer("de-on-call", {
    title: "Data Engineer",
    description: `${DATA_STACK}\n${HYBRID_2}\nAstreintes un week-end sur quatre.`,
  }),
  offer("de-contract-unknown", {
    title: "Data Engineer",
    contractType: "UNKNOWN",
    description: `${DATA_STACK}\n${HYBRID_2}`,
  }),
  offer("frontend", {
    title: "Développeur front-end React",
    description: `Interfaces en React et TypeScript, design system et accessibilité.\n${HYBRID_2}`,
    salaryMin: 55000,
    salaryMax: 65000,
    salaryCurrency: "EUR",
    salaryPeriod: "YEAR",
  }),
  offer("design-remote", {
    title: "Product Designer",
    remotePolicy: "FULL_REMOTE",
    ...LYON,
    description:
      "Vous ferez évoluer notre design system dans Figma et mènerez la recherche utilisateur. Équipe asynchrone.",
    salaryMin: 52000,
    salaryMax: 60000,
    salaryCurrency: "EUR",
    salaryPeriod: "YEAR",
  }),
  offer("design-hybrid", {
    title: "Product Designer",
    description: "Design system dans Figma. Télétravail 2 jours par semaine.",
  }),
  offer("design-unknown-remote", {
    title: "UX Designer",
    remotePolicy: "UNKNOWN",
    description: "Maquettes Figma et recherche utilisateur.",
  }),
];

export type MatchingCase = {
  name: string;
  profile: CandidateProfile;
  rails: CandidateRails;
  /** Offres exclues, avec la règle qui doit les exclure. */
  excluded: Record<string, ViolationCode>;
  /** Début attendu du classement (ordre strict). */
  top: string[];
  /** Informations manquantes attendues pour certaines offres retenues. */
  unknowns?: Record<string, UnknownCode[]>;
  /** Offres sans rapport avec le profil : sous le seuil de conservation (40). */
  unrelated?: string[];
};

const NO_RAILS: CandidateRails = {
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

export const CASES: MatchingCase[] = [
  {
    name: "data engineer senior, Paris, hybride",
    profile: {
      seniority: "SENIOR",
      achievements: [
        {
          id: "a-pipeline",
          title: "Refonte des pipelines de données",
          text: "Refonte des pipelines de données. Migration des traitements Python et SQL vers Airflow, entrepôt modélisé avec dbt. Python, SQL, Airflow",
          evidenceLevel: "DOCUMENT",
          skills: ["Python", "SQL", "Airflow"],
        },
        {
          id: "a-spark",
          title: "Traitement Spark temps réel",
          text: "Traitement Spark temps réel des événements de la plateforme cloud. Spark",
          evidenceLevel: "DECLARED",
          skills: ["Spark"],
        },
      ],
      skills: [
        { name: "Python", proven: true },
        { name: "SQL", proven: true },
        { name: "Airflow", proven: true },
        { name: "dbt", proven: false },
        { name: "Spark", proven: false },
      ],
    },
    rails: {
      minFixedSalary: 55000,
      targetTotalPackage: 65000,
      remotePolicy: "HYBRID",
      minRemoteDays: 2,
      contractTypes: ["CDI"],
      excludedSectors: ["GAMBLING"],
      excludedCompanies: ["Globex"],
      maxWeeklyHours: 39,
      acceptsOnCall: false,
      culturePreferences: ["ASYNC_FIRST", "LEARNING_CULTURE"],
      locations: [{ ...PARIS, radiusKm: 30 }],
    },
    excluded: {
      "de-low-salary": "salaryBelowFloor",
      "de-freelance": "contractType",
      "de-lyon": "outsideRadius",
      "de-unlocated": "outsideRadius",
      "de-onsite": "remotePolicy",
      "de-one-day": "remoteDays",
      "de-gambling": "excludedSector",
      "de-globex": "excludedCompany",
      "de-hours": "weeklyHours",
      "de-on-call": "onCall",
    },
    top: ["de-great", "de-monthly-ok"],
    unrelated: ["frontend", "design-hybrid"],
    unknowns: {
      "de-no-salary": ["salaryNotStated"],
      "de-contract-unknown": ["salaryNotStated", "contractNotStated"],
    },
  },
  {
    name: "product designer, télétravail complet uniquement",
    profile: {
      seniority: "MID",
      achievements: [
        {
          id: "a-ds",
          title: "Design system multi-produits",
          text: "Design system multi-produits construit dans Figma, adopté par six équipes. Figma, Design system",
          evidenceLevel: "DOCUMENT",
          skills: ["Figma", "Design system"],
        },
      ],
      skills: [
        { name: "Figma", proven: true },
        { name: "Design system", proven: true },
        { name: "Recherche utilisateur", proven: false },
      ],
    },
    rails: {
      ...NO_RAILS,
      minFixedSalary: 50000,
      remotePolicy: "FULL_REMOTE",
      contractTypes: ["CDI", "FREELANCE"],
    },
    excluded: {
      "design-hybrid": "remotePolicy",
      "de-great": "remotePolicy",
      "de-low-salary": "salaryBelowFloor",
    },
    top: ["design-remote", "design-unknown-remote"],
    unrelated: ["de-remote-lyon"],
    unknowns: { "design-unknown-remote": ["salaryNotStated", "remoteNotStated"] },
  },
];
