/**
 * Codes stockés en base et affichés via les traductions (`codes.<famille>.<CODE>`).
 * Fichier sans dépendance serveur : utilisable dans les composants client.
 * Les listes reprenant un enum Prisma sont vérifiées par `tests/unit/codes.test.ts`.
 */

export const VISIBILITY_STATUSES = ["ACTIVE", "OPEN", "INVISIBLE"] as const;
export type VisibilityStatusCode = (typeof VISIBILITY_STATUSES)[number];

export const SENIORITIES = [
  "INTERN",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
  "MANAGER",
  "DIRECTOR",
  "EXECUTIVE",
] as const;
export type SeniorityCode = (typeof SENIORITIES)[number];

export const CONTRACT_TYPES = [
  "CDI",
  "CDD",
  "FREELANCE",
  "TEMPORARY",
  "APPRENTICESHIP",
  "INTERNSHIP",
] as const;
export type ContractTypeCode = (typeof CONTRACT_TYPES)[number];

export const COMPANY_SIZES = [
  "S1_10",
  "S11_50",
  "S51_200",
  "S201_500",
  "S501_1000",
  "S1001_5000",
  "S5001_PLUS",
] as const;
export type CompanySizeCode = (typeof COMPANY_SIZES)[number];

export const COMPANY_STAGES = [
  "STARTUP",
  "SCALEUP",
  "SME",
  "MIDCAP",
  "LARGE_CORP",
  "PUBLIC_SECTOR",
  "NONPROFIT",
  "CONSULTANCY",
] as const;
export type CompanyStageCode = (typeof COMPANY_STAGES)[number];

/** Secteurs (liste ouverte : stockés en texte, validés ici). */
export const SECTORS = [
  "AEROSPACE_DEFENSE",
  "AGRIFOOD",
  "AUTOMOTIVE_MOBILITY",
  "BANKING_INSURANCE",
  "BIOTECH_PHARMA",
  "CONSTRUCTION_REAL_ESTATE",
  "CONSULTING",
  "CYBERSECURITY",
  "ECOMMERCE_RETAIL",
  "EDUCATION_EDTECH",
  "ENERGY_UTILITIES",
  "ENVIRONMENT_CLEANTECH",
  "FINTECH",
  "GAMBLING",
  "GAMING",
  "HEALTHCARE_HEALTHTECH",
  "HOSPITALITY_TOURISM",
  "HR_RECRUITMENT",
  "INDUSTRY_MANUFACTURING",
  "LEGAL",
  "LUXURY_FASHION",
  "MARKETING_ADVERTISING",
  "MEDIA_ENTERTAINMENT",
  "NONPROFIT",
  "OIL_GAS",
  "PUBLIC_ADMINISTRATION",
  "SAAS_SOFTWARE",
  "TELECOM",
  "TOBACCO_ALCOHOL",
  "TRANSPORT_LOGISTICS",
  "OTHER",
] as const;
export type SectorCode = (typeof SECTORS)[number];

export const REMOTE_POLICIES = ["ONSITE", "HYBRID", "FULL_REMOTE"] as const;
export type RemotePolicyCode = (typeof REMOTE_POLICIES)[number];

/** Préférences de culture d'entreprise (choix guidés, facultatifs). */
export const CULTURE_PREFERENCES = [
  "ASYNC_FIRST",
  "FLAT_HIERARCHY",
  "STRUCTURED_PROCESSES",
  "FAST_PACED",
  "WORK_LIFE_BALANCE",
  "LEARNING_CULTURE",
  "MISSION_DRIVEN",
  "DIVERSITY_INCLUSION",
  "INTERNATIONAL",
  "SMALL_TEAMS",
  "ENGINEERING_CULTURE",
  "TRANSPARENT_PAY",
] as const;
export type CulturePreferenceCode = (typeof CULTURE_PREFERENCES)[number];

export const EVIDENCE_LEVELS = ["DECLARED", "DOCUMENT", "VERIFIED"] as const;
export type EvidenceLevelCode = (typeof EVIDENCE_LEVELS)[number];

export const PROOF_KINDS = ["URL", "DOCUMENT", "REFERENCE"] as const;
export type ProofKindCode = (typeof PROOF_KINDS)[number];

/** Niveaux de compétence calculés (voir `derive.ts`). */
export const SKILL_LEVELS = [
  "UNPROVEN",
  "DECLARED",
  "DEMONSTRATED",
  "CONFIRMED",
  "EXPERT",
] as const;
export type SkillLevelCode = (typeof SKILL_LEVELS)[number];
