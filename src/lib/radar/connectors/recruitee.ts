import { applyChannel } from "../apply";
import {
  cleanCity,
  detectContractType,
  detectRemotePolicy,
  isoCountry,
  remoteFromFlags,
} from "../normalize";
import { salaryFromDescription, structuredSalary } from "../salary";
import { cleanString, htmlToText, parseDate } from "../text";
import type { ContractType, Connector, NormalizedOffer } from "../types";
import { atsKey, boardPath, type AtsCompany } from "./ats";

/**
 * Recruitee Careers Site API (publique, celle du site carrière de
 * l'entreprise) : https://docs.recruitee.com/reference/offers
 * `GET https://{entreprise}.recruitee.com/api/offers/` renvoie toutes les
 * offres publiées en une réponse (pas de pagination). Le robots.txt du site
 * carrière est vérifié.
 */
export function recruiteeOffersUrl(boardToken: string): string {
  return `https://${boardPath(boardToken).toLowerCase()}.recruitee.com/api/offers/`;
}

export type RecruiteeOffer = {
  id: number | string;
  slug?: string;
  title?: string;
  status?: string;
  careers_url?: string;
  careers_apply_url?: string;
  description?: string;
  requirements?: string;
  city?: string | null;
  state_name?: string | null;
  country_code?: string | null;
  country?: string | null;
  postal_code?: string | null;
  location?: string | null;
  locations?: {
    city?: string | null;
    state?: string | null;
    country_code?: string | null;
    postal_code?: string | null;
  }[];
  remote?: boolean | null;
  hybrid?: boolean | null;
  on_site?: boolean | null;
  employment_type_code?: string | null;
  experience_code?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  salary?: {
    min?: string | number | null;
    max?: string | number | null;
    currency?: string | null;
    period?: string | null;
  } | null;
};

type RecruiteeBoard = { offers?: RecruiteeOffer[] };

const EMPLOYMENT: Record<string, ContractType> = {
  fulltime_permanent: "CDI",
  parttime_permanent: "CDI",
  fulltime_fixed_term: "CDD",
  parttime_fixed_term: "CDD",
  internship: "INTERNSHIP",
  traineeship: "INTERNSHIP",
  apprenticeship: "APPRENTICESHIP",
  freelance: "FREELANCE",
  temporary: "TEMPORARY",
};

export function recruiteeConnector(company: AtsCompany): Connector<RecruiteeOffer> {
  return {
    source: "recruitee",
    key: atsKey("recruitee", company),
    async fetch({ http }) {
      const { data } = await http.getJson<RecruiteeBoard>(recruiteeOffersUrl(company.boardToken), {
        robots: true,
      });
      if (!data || !Array.isArray(data.offers)) throw new Error("Réponse Recruitee inattendue");
      return { items: data.offers, complete: true };
    },
    map(offer) {
      return mapRecruiteeOffer(offer, company);
    },
  };
}

export function mapRecruiteeOffer(
  offer: RecruiteeOffer,
  company: AtsCompany,
): NormalizedOffer | null {
  if (offer.status && offer.status !== "published") return null;
  const title = cleanString(offer.title);
  const url = cleanString(offer.careers_url);
  if (!title || !url || offer.id === undefined || offer.id === null) return null;

  const description = [htmlToText(offer.description), htmlToText(offer.requirements)]
    .filter(Boolean)
    .join("\n\n");

  // Plusieurs lieux : celui en France est préféré, sinon le lieu principal.
  const places = offer.locations ?? [];
  const french = places.find((l) => l.country_code?.toUpperCase() === "FR");
  const mainCountry = isoCountry(offer.country_code) ?? isoCountry(offer.country);
  const place =
    french && mainCountry !== "FR"
      ? {
          city: french.city,
          region: french.state,
          country: "FR",
          postalCode: french.postal_code,
        }
      : {
          city: offer.city,
          region: offer.state_name,
          country: mainCountry,
          postalCode: offer.postal_code,
        };

  const employment = cleanString(offer.employment_type_code);
  const fromTitle = detectContractType(title);
  const salary =
    structuredSalary({
      min: offer.salary?.min,
      max: offer.salary?.max,
      currency: offer.salary?.currency,
      period: offer.salary?.period,
    }) ?? salaryFromDescription(description);

  return {
    sourceId: String(offer.id),
    url,
    title,
    companyName: company.name,
    companyId: company.id ?? null,
    description,
    location: {
      city: cleanCity(place.city),
      region: cleanString(place.region),
      country: place.country,
    },
    postalCode: cleanString(place.postalCode),
    remotePolicy:
      remoteFromFlags({ remote: offer.remote, hybrid: offer.hybrid, onSite: offer.on_site }) ??
      detectRemotePolicy(title, description),
    contractType: fromTitle !== "UNKNOWN" ? fromTitle : (EMPLOYMENT[employment ?? ""] ?? "UNKNOWN"),
    contractLabel: employment,
    salary,
    sector: company.sector,
    seniority: cleanString(offer.experience_code),
    publishedAt: parseDate(offer.published_at) ?? parseDate(offer.created_at),
    apply: applyChannel({ url: offer.careers_apply_url, description }),
  };
}
