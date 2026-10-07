import { detectContractType, detectRemotePolicy, parseLocationLabel } from "../normalize";
import { cleanString, htmlToText, parseDate } from "../text";
import type { Connector, NormalizedOffer } from "../types";
import { atsKey, boardPath, type AtsCompany } from "./ats";

/**
 * Greenhouse Job Board API (publique, prévue pour l'affichage des offres) :
 * https://developers.greenhouse.io/job-board.html
 * Une seule requête renvoie toutes les offres publiées du board.
 */
export const GREENHOUSE_API = "https://boards-api.greenhouse.io/v1/boards";

export type GreenhouseJob = {
  id: number;
  title?: string;
  absolute_url?: string;
  updated_at?: string;
  first_published?: string;
  company_name?: string;
  location?: { name?: string } | null;
  content?: string;
  departments?: { name?: string }[];
};

type GreenhouseBoard = { jobs?: GreenhouseJob[] };

export function greenhouseConnector(company: AtsCompany): Connector<GreenhouseJob> {
  return {
    source: "greenhouse",
    key: atsKey("greenhouse", company),
    async fetch({ http }) {
      const url = `${GREENHOUSE_API}/${boardPath(company.boardToken)}/jobs?content=true`;
      const { data } = await http.getJson<GreenhouseBoard>(url);
      if (!data || !Array.isArray(data.jobs)) throw new Error("Réponse Greenhouse inattendue");
      return { items: data.jobs, complete: true };
    },
    map(job) {
      return mapGreenhouseJob(job, company);
    },
  };
}

export function mapGreenhouseJob(job: GreenhouseJob, company: AtsCompany): NormalizedOffer | null {
  const title = cleanString(job.title);
  const url = cleanString(job.absolute_url);
  if (!title || !url || job.id === undefined) return null;
  const description = htmlToText(job.content);
  const place = parseLocationLabel(job.location?.name);
  return {
    sourceId: String(job.id),
    url,
    title,
    companyName: company.name,
    companyId: company.id ?? null,
    description,
    location: { city: place.city, region: place.region, country: place.country },
    remotePolicy: place.remote ? "FULL_REMOTE" : detectRemotePolicy(title, description),
    contractType: detectContractType(title),
    contractLabel: null,
    // L'API liste ne fournit pas de rémunération structurée : rien n'est déduit.
    salary: null,
    sector: company.sector,
    seniority: null,
    publishedAt: parseDate(job.first_published) ?? parseDate(job.updated_at),
  };
}
