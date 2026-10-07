import type { ContractType, RemotePolicy, SalaryPeriod } from "@/generated/prisma/enums";
import type { HttpClient } from "./http";

export type { ContractType, RemotePolicy, SalaryPeriod };

export type SourceName = "france_travail" | "greenhouse" | "lever" | "ashby";

/** Rémunération telle qu'annoncée. `null` partout quand rien n'est indiqué. */
export type Salary = {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
  variable: string | null;
  equity: string | null;
  raw: string | null;
};

export type Location = {
  city: string | null;
  region: string | null;
  /** ISO 3166-1 alpha-2 quand il est connu. */
  country: string | null;
};

/** Schéma commun produit par chaque connecteur (étape `map`). */
export type NormalizedOffer = {
  sourceId: string;
  url: string;
  /** URL d'origine (site carrière, ATS) si différente de `url` : sert au dédoublonnage. */
  canonicalUrl?: string | null;
  title: string;
  companyName: string | null;
  companyId?: string | null;
  description: string;
  location: Location;
  remotePolicy: RemotePolicy;
  contractType: ContractType;
  contractLabel: string | null;
  salary: Salary | null;
  sector: string | null;
  seniority: string | null;
  publishedAt: Date | null;
};

export type FetchResult<Raw> = {
  items: Raw[];
  /**
   * Vrai si tout le périmètre a été parcouru. Seule une collecte complète
   * autorise la fermeture des offres disparues.
   */
  complete: boolean;
};

export type ConnectorContext = {
  http: HttpClient;
  now: () => Date;
};

/**
 * Un connecteur = un périmètre de collecte (`key`) : fetch → map → upsert.
 * L'upsert est commun (voir `pipeline.ts`) ; le connecteur ne fait que
 * récupérer les données brutes et les convertir au schéma normalisé.
 */
export interface Connector<Raw = unknown> {
  source: SourceName;
  /** Périmètre : `france_travail`, `greenhouse:dataiku`… */
  key: string;
  fetch(ctx: ConnectorContext): Promise<FetchResult<Raw>>;
  /** `null` pour ignorer une offre (non publiée, hors périmètre…). */
  map(raw: Raw): NormalizedOffer | null;
}
