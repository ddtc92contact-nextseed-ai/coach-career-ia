import type { SalaryPeriod } from "@/generated/prisma/enums";

/**
 * Annualisation des salaires annoncés, en euros bruts (les garde-fous sont
 * exprimés en euros bruts annuels) :
 * - heure : 1 607 h (durée légale annuelle, 35 h × 52 semaines − congés et fériés) ;
 * - jour : 218 jours (forfait jours de référence) ;
 * - mois : 12 mois (un éventuel 13e mois n'est pas supposé).
 * Une autre devise que l'euro n'est pas convertie : le salaire est alors
 * traité comme non comparable (signalé, jamais exclu ni estimé).
 */
export const ANNUAL_FACTORS: Record<SalaryPeriod, number> = {
  HOUR: 1607,
  DAY: 218,
  MONTH: 12,
  YEAR: 1,
};

export type AnnualSalary = { min: number; max: number };

export function annualSalary(offer: {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
}): AnnualSalary | null {
  const low = offer.salaryMin ?? offer.salaryMax;
  const high = offer.salaryMax ?? offer.salaryMin;
  if (low === null || high === null || !(low > 0) || !(high > 0)) return null;
  if (offer.salaryCurrency && offer.salaryCurrency.toUpperCase() !== "EUR") return null;
  // Sans période, seul un montant manifestement annuel est retenu.
  const period = offer.salaryPeriod ?? (high >= 10_000 ? "YEAR" : null);
  if (!period) return null;
  const factor = ANNUAL_FACTORS[period];
  return { min: Math.round(low * factor), max: Math.round(high * factor) };
}
