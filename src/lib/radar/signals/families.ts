import { offerSeniorityRank, SENIORITY_RANK } from "@/lib/matching/signals";
import { normalizeText } from "@/lib/matching/text";

/**
 * Familles de métiers déduites de l'intitulé (fonction pure, sans IA). Ordre
 * significatif : « Data Engineer » relève de la data, pas de l'ingénierie.
 * Intitulé non reconnu : `null` (jamais compté comme nouvelle famille).
 */
export const JOB_FAMILIES = [
  "DATA_AI",
  "ENGINEERING",
  "PRODUCT",
  "DESIGN",
  "SALES",
  "MARKETING",
  "CUSTOMER",
  "OPERATIONS",
  "FINANCE",
  "PEOPLE",
  "LEGAL",
] as const;
export type JobFamily = (typeof JOB_FAMILIES)[number];

const FAMILY_PATTERNS: [JobFamily, RegExp][] = [
  [
    "DATA_AI",
    /\b(?:data|donnees|machine learning|ml|mlops|ia|ai|llm|intelligence artificielle|deep learning|nlp|computer vision|bi|business intelligence|analytics)\b/,
  ],
  [
    "ENGINEERING",
    /\b(?:developpeur|developpeuse|developer|engineer|ingenieur|ingenieure|software|backend|back-end|frontend|front-end|fullstack|full-stack|devops|sre|cloud|devsecops|architecte|architect|qa|cto|tech lead)\b/,
  ],
  ["PRODUCT", /\b(?:product|produit|cpo|product owner|po)\b/],
  ["DESIGN", /\b(?:design|designer|ux|ui)\b/],
  [
    "SALES",
    /\b(?:sales|commercial|commerciale|account executive|account manager|business developer|business development|bizdev|sdr|bdr|vente|ventes|vendeur|vendeuse)\b/,
  ],
  [
    "MARKETING",
    /\b(?:marketing|growth|seo|sea|brand|communication|content|contenu|community manager|cmo)\b/,
  ],
  [
    "CUSTOMER",
    /\b(?:customer|client|clients|support|success|service client|relation client|onboarding)\b/,
  ],
  [
    "FINANCE",
    /\b(?:finance|financier|financiere|comptable|accountant|accounting|comptabilite|controleur de gestion|controller|cfo|tresorerie|fp&a|audit)\b/,
  ],
  [
    "PEOPLE",
    /\b(?:rh|hr|human resources|ressources humaines|recruteur|recruteuse|recruiter|talent|people|paie|payroll)\b/,
  ],
  ["LEGAL", /\b(?:juriste|legal|lawyer|avocat|avocate|compliance|conformite|dpo)\b/],
  [
    "OPERATIONS",
    /\b(?:operations|operationnel|operationnelle|ops|logistique|logistics|supply chain|achats|procurement|office manager)\b/,
  ],
];

export function jobFamily(title: string): JobFamily | null {
  const normalized = normalizeText(title);
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(normalized)) return family;
  }
  return null;
}

/** Poste d'encadrement (manager, responsable, direction) d'après l'intitulé. */
export function isLeadershipRole(title: string, seniority: string | null): boolean {
  const rank = offerSeniorityRank(title, seniority);
  return rank !== null && rank >= SENIORITY_RANK.MANAGER;
}
