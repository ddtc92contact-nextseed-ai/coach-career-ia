import { isValidPoint, isWithinRadius } from "@/lib/geo/distance";
import { annualSalary } from "./salary";
import {
  detectSectors,
  isSameCompany,
  mentionsOnCall,
  statedRemoteDays,
  statedWeeklyHours,
} from "./signals";
import type { CandidateRails, MatchOffer, UnknownCode, ViolationCode } from "./types";

/**
 * Garde-fous : filtres DURS appliqués avant tout score. Une offre qui en viole
 * un n'est jamais proposée, quel que soit son score. Une information absente
 * de l'offre n'est pas une violation : elle est signalée (`unknowns`).
 *
 * Chaque règle est une fonction pure, testée séparément
 * (`tests/unit/matching-filters.test.ts`).
 */

export type RuleResult = { violation?: ViolationCode; unknown?: UnknownCode };
export type Rule = (offer: MatchOffer, rails: CandidateRails) => RuleResult;

const ok: RuleResult = {};

/** Salaire plancher : le haut de la fourchette annualisée doit l'atteindre. */
export const salaryFloorRule: Rule = (offer, rails) => {
  const annual = annualSalary(offer);
  if (!annual) return { unknown: "salaryNotStated" };
  if (rails.minFixedSalary !== null && annual.max < rails.minFixedSalary) {
    return { violation: "salaryBelowFloor" };
  }
  return ok;
};

/**
 * Politique de télétravail : `FULL_REMOTE` exige une offre en télétravail
 * complet, `HYBRID` au moins de l'hybride, `ONSITE` accepte tout.
 */
export const remotePolicyRule: Rule = (offer, rails) => {
  if (!rails.remotePolicy || rails.remotePolicy === "ONSITE") return ok;
  if (offer.remotePolicy === "UNKNOWN") return { unknown: "remoteNotStated" };
  if (rails.remotePolicy === "FULL_REMOTE" && offer.remotePolicy !== "FULL_REMOTE") {
    return { violation: "remotePolicy" };
  }
  if (rails.remotePolicy === "HYBRID" && offer.remotePolicy === "ONSITE") {
    return { violation: "remotePolicy" };
  }
  return ok;
};

/** Jours de télétravail minimum, quand l'offre en annonce un nombre. */
export const remoteDaysRule: Rule = (offer, rails) => {
  const min = rails.minRemoteDays;
  if (!min || min <= 0 || offer.remotePolicy === "FULL_REMOTE") return ok;
  if (offer.remotePolicy === "ONSITE") return { violation: "remoteDays" };
  const days = statedRemoteDays(offer.description);
  if (days === null) return { unknown: "remoteDaysNotStated" };
  return days < min ? { violation: "remoteDays" } : ok;
};

/**
 * Zone acceptée : une offre en télétravail complet passe toujours ; sinon elle
 * doit être dans le rayon d'un lieu localisé. Une offre sans coordonnées ne
 * correspond jamais (on n'invente pas de position). Si aucun lieu du candidat
 * n'a pu être localisé, le filtre ne peut pas s'appliquer : c'est signalé.
 */
export const locationRule: Rule = (offer, rails) => {
  if (rails.locations.length === 0 || offer.remotePolicy === "FULL_REMOTE") return ok;
  const located = rails.locations.filter((l) => isValidPoint(l));
  if (located.length === 0) return { unknown: "locationNotChecked" };
  return isWithinRadius(offer, located) ? ok : { violation: "outsideRadius" };
};

/** Types de contrat acceptés ; un contrat non précisé est signalé. */
export const contractTypeRule: Rule = (offer, rails) => {
  if (rails.contractTypes.length === 0) return ok;
  if (offer.contractType === "UNKNOWN") return { unknown: "contractNotStated" };
  return (rails.contractTypes as string[]).includes(offer.contractType)
    ? ok
    : { violation: "contractType" };
};

/** Secteurs exclus, d'après le secteur déclaré de l'offre. */
export const excludedSectorRule: Rule = (offer, rails) => {
  if (rails.excludedSectors.length === 0) return ok;
  const sectors = detectSectors(offer.sector);
  return sectors.some((s) => rails.excludedSectors.includes(s))
    ? { violation: "excludedSector" }
    : ok;
};

/** Entreprises exclues : noms normalisés (casse, accents, forme juridique). */
export const excludedCompanyRule: Rule = (offer, rails) => {
  if (rails.excludedCompanies.length === 0 || !offer.companyName) return ok;
  return rails.excludedCompanies.some((name) => isSameCompany(offer.companyName!, name))
    ? { violation: "excludedCompany" }
    : ok;
};

/** Durée hebdomadaire maximale, quand l'offre l'annonce. */
export const weeklyHoursRule: Rule = (offer, rails) => {
  if (rails.maxWeeklyHours === null) return ok;
  const hours = statedWeeklyHours(`${offer.contractLabel ?? ""}\n${offer.description}`);
  if (hours === null) return { unknown: "hoursNotStated" };
  return hours > rails.maxWeeklyHours ? { violation: "weeklyHours" } : ok;
};

/** Astreintes : exclues si le candidat ne les accepte pas et que l'offre en mentionne. */
export const onCallRule: Rule = (offer, rails) => {
  if (rails.acceptsOnCall) return ok;
  return mentionsOnCall(`${offer.title}\n${offer.description}`) ? { violation: "onCall" } : ok;
};

export const RULES: Record<ViolationCode, Rule> = {
  salaryBelowFloor: salaryFloorRule,
  remotePolicy: remotePolicyRule,
  remoteDays: remoteDaysRule,
  outsideRadius: locationRule,
  contractType: contractTypeRule,
  excludedSector: excludedSectorRule,
  excludedCompany: excludedCompanyRule,
  weeklyHours: weeklyHoursRule,
  onCall: onCallRule,
};

export type GuardRailCheck = {
  pass: boolean;
  violations: ViolationCode[];
  unknowns: UnknownCode[];
};

/** Applique tous les garde-fous. `pass` est faux dès qu'une règle est violée. */
export function checkGuardRails(offer: MatchOffer, rails: CandidateRails): GuardRailCheck {
  const violations: ViolationCode[] = [];
  const unknowns: UnknownCode[] = [];
  for (const rule of Object.values(RULES)) {
    const result = rule(offer, rails);
    if (result.violation) violations.push(result.violation);
    if (result.unknown && !unknowns.includes(result.unknown)) unknowns.push(result.unknown);
  }
  return { pass: violations.length === 0, violations, unknowns };
}
