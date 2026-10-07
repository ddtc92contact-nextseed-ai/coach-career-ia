import { applyChannel } from "../apply";
import {
  countryCode,
  detectContractType,
  detectRemotePolicy,
  parseLocationLabel,
  remoteFromWorkplace,
} from "../normalize";
import { periodFromInterval, positiveNumber } from "../salary";
import { cleanString, htmlToText, parseDate } from "../text";
import type { Connector, NormalizedOffer, Salary } from "../types";
import { atsKey, boardPath, type AtsCompany } from "./ats";

/**
 * Lever Postings API (publique) : https://github.com/lever/postings-api
 * `mode=json` renvoie toutes les offres publiées du site en une requête.
 */
export const LEVER_API = "https://api.lever.co/v0/postings";
export const LEVER_API_EU = "https://api.eu.lever.co/v0/postings";

export type LeverPosting = {
  id: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  country?: string | null;
  workplaceType?: string | null;
  categories?: {
    commitment?: string | null;
    department?: string | null;
    location?: string | null;
    team?: string | null;
    allLocations?: string[];
  };
  descriptionPlain?: string;
  description?: string;
  lists?: { text?: string; content?: string }[];
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } | null;
  salaryDescriptionPlain?: string;
  salaryDescription?: string;
};

export function leverConnector(company: AtsCompany): Connector<LeverPosting> {
  const base = company.atsRegion === "eu" ? LEVER_API_EU : LEVER_API;
  return {
    source: "lever",
    key: atsKey("lever", company),
    async fetch({ http }) {
      const { data } = await http.getJson<LeverPosting[]>(
        `${base}/${boardPath(company.boardToken)}?mode=json`,
      );
      if (!Array.isArray(data)) throw new Error("Réponse Lever inattendue");
      return { items: data, complete: true };
    },
    map(posting) {
      return mapLeverPosting(posting, company);
    },
  };
}

function leverSalary(posting: LeverPosting): Salary | null {
  const range = posting.salaryRange;
  const raw = cleanString(posting.salaryDescriptionPlain ?? htmlToText(posting.salaryDescription));
  const min = positiveNumber(range?.min);
  const max = positiveNumber(range?.max);
  if (min === null && max === null) return null;
  return {
    min,
    max,
    currency: cleanString(range?.currency)?.toUpperCase() ?? null,
    period: periodFromInterval(range?.interval),
    variable: null,
    equity: null,
    raw,
  };
}

export function mapLeverPosting(
  posting: LeverPosting,
  company: AtsCompany,
): NormalizedOffer | null {
  const title = cleanString(posting.text);
  const url = cleanString(posting.hostedUrl);
  if (!title || !url || !posting.id) return null;

  const lists = (posting.lists ?? [])
    .map((l) => `${cleanString(l.text) ?? ""}\n${htmlToText(l.content)}`.trim())
    .filter(Boolean);
  const description = [
    cleanString(posting.descriptionPlain)
      ? posting.descriptionPlain!.trim()
      : htmlToText(posting.description),
    ...lists,
    posting.additionalPlain?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  const categories = posting.categories ?? {};
  const place = parseLocationLabel(categories.location);
  const commitment = cleanString(categories.commitment);
  return {
    sourceId: posting.id,
    url,
    title,
    companyName: company.name,
    companyId: company.id ?? null,
    description,
    location: {
      city: place.city,
      region: place.region,
      country: countryCode(posting.country) ?? place.country,
    },
    remotePolicy:
      remoteFromWorkplace(posting.workplaceType) ??
      (place.remote ? "FULL_REMOTE" : detectRemotePolicy(title, description)),
    contractType: detectContractType(commitment, title),
    contractLabel: commitment,
    salary: leverSalary(posting),
    sector: company.sector,
    seniority: null,
    publishedAt: parseDate(posting.createdAt),
    apply: applyChannel({ url: posting.applyUrl, description }),
  };
}
