import { applyChannel } from "../apply";
import {
  cleanCity,
  countryCode,
  detectContractType,
  detectRemotePolicy,
  parseLocationLabel,
  remoteFromWorkplace,
} from "../normalize";
import { periodFromInterval, positiveNumber } from "../salary";
import { cleanString, htmlToText, parseDate } from "../text";
import type { ContractType, Connector, NormalizedOffer, Salary } from "../types";
import { atsKey, boardPath, type AtsCompany } from "./ats";

/**
 * Ashby Job Postings API (publique) :
 * https://developers.ashbyhq.com/docs/public-job-posting-api
 */
export const ASHBY_API = "https://api.ashbyhq.com/posting-api/job-board";

type AshbyComponent = {
  compensationType?: string;
  interval?: string;
  currencyCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
};

export type AshbyJob = {
  id: string;
  title?: string;
  department?: string | null;
  team?: string | null;
  employmentType?: string | null;
  location?: string | null;
  isListed?: boolean;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  address?: {
    postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string };
  } | null;
  compensation?: {
    compensationTierSummary?: string | null;
    summaryComponents?: AshbyComponent[];
  } | null;
};

type AshbyBoard = { jobs?: AshbyJob[] };

const EMPLOYMENT: Record<string, ContractType> = {
  Intern: "INTERNSHIP",
  Contract: "FREELANCE",
  Temporary: "TEMPORARY",
};

export function ashbyConnector(company: AtsCompany): Connector<AshbyJob> {
  return {
    source: "ashby",
    key: atsKey("ashby", company),
    async fetch({ http }) {
      const { data } = await http.getJson<AshbyBoard>(
        `${ASHBY_API}/${boardPath(company.boardToken)}?includeCompensation=true`,
      );
      if (!data || !Array.isArray(data.jobs)) throw new Error("Réponse Ashby inattendue");
      return { items: data.jobs, complete: true };
    },
    map(job) {
      return mapAshbyJob(job, company);
    },
  };
}

function describeRange(c: AshbyComponent): string | null {
  const min = positiveNumber(c.minValue);
  const max = positiveNumber(c.maxValue);
  if (min === null && max === null) return null;
  const range = min !== null && max !== null && min !== max ? `${min}–${max}` : String(min ?? max);
  return `${range} ${c.currencyCode ?? ""}`.trim();
}

function ashbySalary(job: AshbyJob): Salary | null {
  const components = job.compensation?.summaryComponents ?? [];
  const base = components.find((c) => c.compensationType === "Salary");
  const equity = components
    .filter((c) => c.compensationType?.startsWith("Equity"))
    .map((c) => {
      const value = describeRange(c);
      return value && c.compensationType === "EquityPercentage" ? `${value} %` : value;
    })
    .filter(Boolean)
    .join(", ");
  const variable = components
    .filter((c) => c.compensationType === "Bonus" || c.compensationType === "Commission")
    .map((c) => {
      const value = describeRange(c);
      return value ? `${c.compensationType} ${value}` : c.compensationType!;
    })
    .join(", ");

  const min = positiveNumber(base?.minValue);
  const max = positiveNumber(base?.maxValue);
  if (min === null && max === null && !equity && !variable) return null;
  const hasAmount = min !== null || max !== null;
  return {
    min,
    max,
    currency: hasAmount ? (cleanString(base?.currencyCode) ?? null) : null,
    period: hasAmount ? periodFromInterval(base?.interval) : null,
    variable: variable || null,
    equity: equity || null,
    raw: cleanString(job.compensation?.compensationTierSummary),
  };
}

export function mapAshbyJob(job: AshbyJob, company: AtsCompany): NormalizedOffer | null {
  if (job.isListed === false) return null;
  const title = cleanString(job.title);
  const url = cleanString(job.jobUrl);
  if (!title || !url || !job.id) return null;

  const description = cleanString(job.descriptionPlain)
    ? job.descriptionPlain!.trim()
    : htmlToText(job.descriptionHtml);
  const postal = job.address?.postalAddress;
  const place = parseLocationLabel(job.location);
  const employment = cleanString(job.employmentType);

  let remotePolicy = remoteFromWorkplace(job.workplaceType);
  if (!remotePolicy) {
    remotePolicy =
      job.isRemote === true || place.remote
        ? "FULL_REMOTE"
        : detectRemotePolicy(title, description);
  }
  const fromTitle = detectContractType(title);

  return {
    sourceId: job.id,
    url,
    title,
    companyName: company.name,
    companyId: company.id ?? null,
    description,
    location: {
      city: cleanCity(postal?.addressLocality) ?? place.city,
      region: cleanString(postal?.addressRegion) ?? place.region,
      country: countryCode(postal?.addressCountry) ?? place.country,
    },
    remotePolicy,
    contractType: fromTitle !== "UNKNOWN" ? fromTitle : (EMPLOYMENT[employment ?? ""] ?? "UNKNOWN"),
    contractLabel: employment,
    salary: ashbySalary(job),
    sector: company.sector,
    seniority: null,
    publishedAt: parseDate(job.publishedAt),
    apply: applyChannel({ url: job.applyUrl, description }),
  };
}
