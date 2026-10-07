import { cleanCity, detectContractType, detectRemotePolicy, isoCountry } from "../normalize";
import { salaryFromDescription } from "../salary";
import { cleanString, htmlToText, parseDate } from "../text";
import type { ContractType, Connector, NormalizedOffer } from "../types";
import { atsKey, boardPath, type AtsCompany } from "./ats";

/**
 * Workable : endpoint public du widget « job board » des pages carrière
 * (https://help.workable.com/hc/en-us/articles/115012771647). `details=true`
 * ajoute le texte des annonces ; toutes les offres publiées arrivent en une
 * réponse (pas de pagination). Le robots.txt de `apply.workable.com` est
 * vérifié, et l'hôte limite fortement le débit (voir `HOST_INTERVALS`).
 */
export const WORKABLE_WIDGET_API = "https://apply.workable.com/api/v1/widget/accounts";

export type WorkableLocation = {
  country?: string | null;
  countryCode?: string | null;
  city?: string | null;
  region?: string | null;
  hidden?: boolean;
};

export type WorkableJob = {
  shortcode: string;
  title?: string;
  url?: string;
  shortlink?: string;
  employment_type?: string | null;
  telecommuting?: boolean | null;
  department?: string | null;
  experience?: string | null;
  published_on?: string | null;
  created_at?: string | null;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  locations?: WorkableLocation[];
  description?: string;
};

type WorkableBoard = { name?: string; jobs?: WorkableJob[] };

// « Temporary » est la catégorie « durée déterminée » de Workable : les
// employeurs français l'utilisent pour leurs CDD (l'intérim passe par une agence).
const EMPLOYMENT: Record<string, ContractType> = {
  internship: "INTERNSHIP",
  temporary: "CDD",
  apprenticeship: "APPRENTICESHIP",
};

export function workableConnector(company: AtsCompany): Connector<WorkableJob> {
  return {
    source: "workable",
    key: atsKey("workable", company),
    async fetch({ http }) {
      const { data } = await http.getJson<WorkableBoard>(
        `${WORKABLE_WIDGET_API}/${boardPath(company.boardToken)}?details=true`,
        { robots: true },
      );
      if (!data || !Array.isArray(data.jobs)) throw new Error("Réponse Workable inattendue");
      return { items: data.jobs, complete: true };
    },
    map(job) {
      return mapWorkableJob(job, company);
    },
  };
}

export function mapWorkableJob(job: WorkableJob, company: AtsCompany): NormalizedOffer | null {
  const title = cleanString(job.title);
  const url = cleanString(job.url) ?? cleanString(job.shortlink);
  if (!title || !url || !job.shortcode) return null;
  const description = htmlToText(job.description);

  // Plusieurs lieux : le premier visible en France, sinon le premier visible.
  const visible = (job.locations ?? []).filter((l) => !l.hidden);
  const place = visible.find((l) => isoCountry(l.countryCode ?? l.country) === "FR") ??
    visible[0] ?? {
      city: job.city,
      region: job.state,
      country: job.country,
      countryCode: null,
    };

  const employment = cleanString(job.employment_type);
  const fromTitle = detectContractType(title);

  return {
    sourceId: job.shortcode,
    url,
    title,
    companyName: company.name,
    companyId: company.id ?? null,
    description,
    location: {
      city: cleanCity(place.city),
      region: cleanString(place.region),
      country: isoCountry(place.countryCode) ?? isoCountry(place.country),
    },
    remotePolicy:
      job.telecommuting === true ? "FULL_REMOTE" : detectRemotePolicy(title, description),
    contractType:
      fromTitle !== "UNKNOWN"
        ? fromTitle
        : (EMPLOYMENT[employment?.toLowerCase() ?? ""] ?? "UNKNOWN"),
    contractLabel: employment,
    // Le widget ne publie pas de fourchette : seule une mention explicite du texte compte.
    salary: salaryFromDescription(description),
    sector: company.sector,
    seniority: cleanString(job.experience),
    publishedAt: parseDate(job.published_on) ?? parseDate(job.created_at),
  };
}
