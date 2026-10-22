import type {
  ContractTypeCode,
  CulturePreferenceCode,
  EvidenceLevelCode,
  RemotePolicyCode,
  SectorCode,
  SeniorityCode,
} from "@/lib/career/codes";
import type { ContractType, RemotePolicy, SalaryPeriod } from "@/generated/prisma/enums";

/** Offre telle que le matching la lit (offre ouverte et canonique du radar). */
export type MatchOffer = {
  id: string;
  title: string;
  description: string;
  companyName: string | null;
  /** Entreprise rattachée par le radar (`Company.id`), pour les entreprises suivies. */
  companyId?: string | null;
  /** Secteur déclaré (texte libre de la source). */
  sector: string | null;
  /** Expérience demandée, texte libre (« 5 An(s) », « Débutant accepté »). */
  seniority: string | null;
  contractLabel: string | null;
  latitude: number | null;
  longitude: number | null;
  remotePolicy: RemotePolicy;
  contractType: ContractType;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
};

/** Garde-fous du candidat, entreprises exclues DÉCHIFFRÉES (jamais journalisées). */
export type CandidateRails = {
  minFixedSalary: number | null;
  targetTotalPackage: number | null;
  remotePolicy: RemotePolicyCode | null;
  minRemoteDays: number | null;
  contractTypes: ContractTypeCode[];
  excludedSectors: SectorCode[];
  excludedCompanies: string[];
  maxWeeklyHours: number | null;
  acceptsOnCall: boolean;
  /**
   * Accord explicite pour les offres en télétravail complet situées hors de
   * la zone (ou sans lieu). Implicite avec la politique `FULL_REMOTE`, voir
   * `remoteOutsideZoneAccepted`.
   */
  acceptsRemoteOutsideZone: boolean;
  culturePreferences: CulturePreferenceCode[];
  /** Lieux acceptés ; coordonnées `null` si le lieu n'a pas été localisé. */
  locations: { latitude: number | null; longitude: number | null; radiusKm: number }[];
};

export type CandidateAchievement = {
  id: string;
  title: string;
  /** Texte embarqué : titre, contexte, actions, résultat, compétences. */
  text: string;
  evidenceLevel: EvidenceLevelCode;
  skills: string[];
};

/** Mémoire de carrière utile au matching (profil pseudonymisé). */
export type CandidateProfile = {
  /** Séniorité du poste actuel ou le plus récent. */
  seniority: SeniorityCode | null;
  achievements: CandidateAchievement[];
  /** `proven` : au moins une réalisation prouvée utilise la compétence. */
  skills: { name: string; proven: boolean }[];
};

/** Garde-fou violé : l'offre est exclue, quel que soit son score. */
export const VIOLATION_CODES = [
  "salaryBelowFloor",
  "remotePolicy",
  "remoteDays",
  "outsideRadius",
  "contractType",
  "excludedSector",
  "excludedCompany",
  "weeklyHours",
  "onCall",
] as const;
export type ViolationCode = (typeof VIOLATION_CODES)[number];

/** Information absente de l'offre : signalée au candidat, sans exclure l'offre. */
export const UNKNOWN_CODES = [
  "salaryNotStated",
  "remoteNotStated",
  "remoteDaysNotStated",
  "contractNotStated",
  "hoursNotStated",
  "locationNotChecked",
  "seniorityNotStated",
  "cultureNotStated",
  /** Télétravail complet, mais l'offre mentionne des déplacements (siège, clients…). */
  "remoteWithTravel",
] as const;
export type UnknownCode = (typeof UNKNOWN_CODES)[number];

export const GAP_CODES = [
  "seniorityAbove",
  "seniorityBelow",
  "salaryBelowTarget",
  "unprovenSkill",
  "fewSkills",
] as const;
export type GapCode = (typeof GAP_CODES)[number];
