import type { ContractType, SalaryPeriod } from "@/generated/prisma/enums";
import { ANNUAL_FACTORS } from "@/lib/matching/salary";

/**
 * Réglages des repères de salaire du marché (Market Radar). Tous les choix de
 * calcul sont ici, et seulement ici : les ajuster ne demande pas de toucher
 * au calcul (`./compute.ts`).
 *
 * Les repères sont tirés UNIQUEMENT des fourchettes publiées dans les offres
 * collectées : jamais estimés, jamais pris sur un site de salaires.
 */

const DEFAULT_MIN_SAMPLE = 10;

/** Taille minimale d'un échantillon publié (`SALARY_BENCHMARK_MIN_SAMPLE`, défaut 10, minimum 3). */
export function minSampleFromEnv(value = process.env.SALARY_BENCHMARK_MIN_SAMPLE): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 3 ? parsed : DEFAULT_MIN_SAMPLE;
}

export type BenchmarkConfig = {
  /** En dessous de ce nombre d'offres, un repère n'est pas publié. */
  minSample: number;
  /** Offres vues (publiées) sur cette période glissante, en jours. */
  lookbackDays: number;
  /**
   * Annualisation des montants (brut) : heure × 1 607 h (durée légale
   * annuelle), jour × 218 (forfait jours), mois × 12 (pas de 13e mois
   * supposé). Mêmes hypothèses que le filtre de salaire du matching.
   */
  annualFactors: Record<SalaryPeriod, number>;
  /**
   * Taux de conversion fixes vers l'euro (indicatifs, révisés à la main).
   * Une devise absente de la table est ignorée : l'offre n'entre dans aucun
   * repère.
   */
  eurRates: Record<string, number>;
  /** Pays où un montant sans devise explicite est lu comme en euros. */
  euroCountries: readonly string[];
  /**
   * Plage plausible d'un salaire annuel brut en euros : en dehors, la valeur
   * est écartée (saisie erronée, temps partiel, montant mensuel lu comme
   * annuel…).
   */
  saneRange: { min: number; max: number };
  /**
   * Contrats exclus : un TJM de freelance n'est pas un salaire brut, la
   * gratification d'un stage ou d'une alternance est encadrée.
   */
  excludedContracts: readonly ContractType[];
};

export const BENCHMARK_CONFIG: BenchmarkConfig = {
  minSample: minSampleFromEnv(),
  lookbackDays: 365,
  annualFactors: ANNUAL_FACTORS,
  eurRates: { EUR: 1, CHF: 1.06, GBP: 1.17, USD: 0.9, CAD: 0.66 },
  euroCountries: [
    "FR",
    "BE",
    "LU",
    "DE",
    "AT",
    "NL",
    "IE",
    "ES",
    "PT",
    "IT",
    "FI",
    "EE",
    "LV",
    "LT",
    "SK",
    "SI",
    "GR",
    "CY",
    "MT",
    "HR",
    "MC",
  ],
  saneRange: { min: 15_000, max: 400_000 },
  excludedContracts: ["FREELANCE", "INTERNSHIP", "APPRENTICESHIP"],
};
