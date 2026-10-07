import type { ContractType, RemotePolicy, SalaryPeriod } from "@/generated/prisma/enums";

export const SOURCE_LABELS: Record<string, string> = {
  france_travail: "France Travail",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
};

export const REMOTE_LABELS: Record<RemotePolicy, string> = {
  ONSITE: "Sur site",
  HYBRID: "Hybride",
  FULL_REMOTE: "Télétravail complet",
  UNKNOWN: "Télétravail non précisé",
};

export const CONTRACT_LABELS: Record<ContractType, string> = {
  CDI: "CDI",
  CDD: "CDD",
  FREELANCE: "Freelance",
  INTERNSHIP: "Stage",
  APPRENTICESHIP: "Alternance",
  TEMPORARY: "Intérim / saisonnier",
  OTHER: "Autre contrat",
  UNKNOWN: "Contrat non précisé",
};

const PERIOD_LABELS: Record<SalaryPeriod, string> = {
  HOUR: "/ heure",
  DAY: "/ jour",
  MONTH: "/ mois",
  YEAR: "/ an",
};

type SalaryFields = {
  salaryMin: { toString(): string } | null;
  salaryMax: { toString(): string } | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryVariable: string | null;
  salaryEquity: string | null;
};

/** Rémunération annoncée, ou `null` si la source n'en indique aucune. */
export function formatSalary(offer: SalaryFields): string | null {
  const money = (value: { toString(): string }) =>
    new Intl.NumberFormat("fr-FR", {
      style: offer.salaryCurrency ? "currency" : "decimal",
      currency: offer.salaryCurrency ?? undefined,
      maximumFractionDigits: 2,
    }).format(Number(value.toString()));
  const min = offer.salaryMin ? money(offer.salaryMin) : null;
  const max = offer.salaryMax ? money(offer.salaryMax) : null;
  let base: string | null = null;
  if (min && max) base = min === max ? min : `${min} – ${max}`;
  else if (min) base = `à partir de ${min}`;
  else if (max) base = `jusqu'à ${max}`;
  if (base && offer.salaryPeriod) base = `${base} ${PERIOD_LABELS[offer.salaryPeriod]}`;
  const extras = [
    offer.salaryVariable ? `variable : ${offer.salaryVariable}` : null,
    offer.salaryEquity ? `equity : ${offer.salaryEquity}` : null,
  ].filter(Boolean);
  const parts = [base, ...extras].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
