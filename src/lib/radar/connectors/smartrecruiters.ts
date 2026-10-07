import { HttpError } from "../http";
import {
  cleanCity,
  detectContractType,
  detectRemotePolicy,
  isoCountry,
  remoteFromFlags,
} from "../normalize";
import { salaryFromDescription } from "../salary";
import { cleanString, htmlToText, parseDate } from "../text";
import type { ContractType, Connector, NormalizedOffer } from "../types";
import { atsKey, boardPath, type AtsCompany } from "./ats";

/**
 * SmartRecruiters Posting API (publique, sans authentification, prévue pour
 * les sites carrière) : https://developers.smartrecruiters.com/docs/posting-api
 * La liste est paginée (`limit` ≤ 100, `offset`) et ne contient pas le texte
 * de l'annonce : chaque offre est relue via `/postings/{id}`.
 *
 * L'hôte `api.smartrecruiters.com` publie un robots.txt : il est vérifié
 * avant toute requête (voir README, « décision en attente »).
 */
export const SMARTRECRUITERS_API = "https://api.smartrecruiters.com/v1/companies";
export const SMARTRECRUITERS_PAGE_SIZE = 100;
/** Plafond d'offres par entreprise : au-delà, la collecte est marquée incomplète. */
export const SMARTRECRUITERS_MAX_POSTINGS = 1000;

type Labelled = { id?: string | null; label?: string | null } | null;

export type SmartRecruitersPosting = {
  id: string;
  name?: string;
  releasedDate?: string;
  postingUrl?: string;
  active?: boolean;
  visibility?: string;
  company?: { identifier?: string; name?: string } | null;
  location?: {
    city?: string | null;
    region?: string | null;
    country?: string | null;
    postalCode?: string | null;
    remote?: boolean | null;
    hybrid?: boolean | null;
    latitude?: string | number | null;
    longitude?: string | number | null;
    fullLocation?: string | null;
  } | null;
  typeOfEmployment?: Labelled;
  experienceLevel?: Labelled;
  department?: Labelled;
  customField?: { fieldLabel?: string; valueLabel?: string }[];
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string } | undefined>;
  } | null;
};

type PostingPage = {
  offset?: number;
  limit?: number;
  totalFound?: number;
  content?: SmartRecruitersPosting[];
};

const EMPLOYMENT: Record<string, ContractType> = {
  permanent: "CDI",
  intern: "INTERNSHIP",
  internship: "INTERNSHIP",
  temporary: "TEMPORARY",
  freelance: "FREELANCE",
};

const SECTIONS = [
  "jobDescription",
  "qualifications",
  "additionalInformation",
  "companyDescription",
];

export function smartRecruitersConnector(
  company: AtsCompany,
  options: { pageSize?: number; maxPostings?: number } = {},
): Connector<SmartRecruitersPosting> {
  const pageSize = options.pageSize ?? SMARTRECRUITERS_PAGE_SIZE;
  const maxPostings = options.maxPostings ?? SMARTRECRUITERS_MAX_POSTINGS;
  const base = `${SMARTRECRUITERS_API}/${boardPath(company.boardToken)}/postings`;
  return {
    source: "smartrecruiters",
    key: atsKey("smartrecruiters", company),
    async fetch({ http }) {
      const listed: SmartRecruitersPosting[] = [];
      let complete = true;
      for (let offset = 0; ; offset += pageSize) {
        if (offset >= maxPostings) {
          complete = false;
          break;
        }
        const { data } = await http.getJson<PostingPage>(
          `${base}?limit=${pageSize}&offset=${offset}`,
          { robots: true },
        );
        if (!data || !Array.isArray(data.content)) {
          throw new Error("Réponse SmartRecruiters inattendue");
        }
        listed.push(...data.content);
        const total = typeof data.totalFound === "number" ? data.totalFound : 0;
        if (data.content.length < pageSize || offset + data.content.length >= total) break;
      }

      // Texte de l'annonce : une requête par offre (débit limité par le client).
      const items: SmartRecruitersPosting[] = [];
      for (const posting of listed) {
        if (!posting?.id) continue;
        try {
          const { data } = await http.getJson<SmartRecruitersPosting>(
            `${base}/${boardPath(String(posting.id))}`,
            { robots: true },
          );
          items.push({ ...posting, ...data });
        } catch (error) {
          // Dépubliée entre la liste et le détail : elle sera fermée.
          if (error instanceof HttpError && error.status === 404) continue;
          throw error;
        }
      }
      return { items, complete };
    },
    map(posting) {
      return mapSmartRecruitersPosting(posting, company);
    },
  };
}

function coordinate(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function mapSmartRecruitersPosting(
  posting: SmartRecruitersPosting,
  company: AtsCompany,
): NormalizedOffer | null {
  if (posting.active === false) return null;
  if (posting.visibility && posting.visibility !== "PUBLIC") return null;
  const title = cleanString(posting.name);
  if (!title || !posting.id) return null;
  const url =
    cleanString(posting.postingUrl) ??
    `https://jobs.smartrecruiters.com/${encodeURIComponent(company.boardToken)}/${encodeURIComponent(posting.id)}`;

  const sections = posting.jobAd?.sections ?? {};
  const description = SECTIONS.map((key) => {
    const section = sections[key];
    const text = htmlToText(section?.text);
    return text ? `${cleanString(section?.title) ?? ""}\n${text}`.trim() : "";
  })
    .filter(Boolean)
    .join("\n\n");

  const location = posting.location ?? {};
  const latitude = coordinate(location.latitude);
  const longitude = coordinate(location.longitude);
  const contractField = posting.customField?.find((f) =>
    /contrat|contract/i.test(f.fieldLabel ?? ""),
  )?.valueLabel;
  const employment = cleanString(posting.typeOfEmployment?.id);
  let contractType = detectContractType(title);
  if (contractType === "UNKNOWN") contractType = detectContractType(contractField);
  if (contractType === "UNKNOWN") contractType = EMPLOYMENT[employment ?? ""] ?? "UNKNOWN";

  return {
    sourceId: String(posting.id),
    url,
    title,
    companyName: company.name,
    companyId: company.id ?? null,
    description,
    location: {
      city: cleanCity(location.city),
      region: cleanString(location.region),
      country: isoCountry(location.country),
    },
    coordinates: latitude !== null && longitude !== null ? { latitude, longitude } : null,
    postalCode: cleanString(location.postalCode),
    remotePolicy:
      remoteFromFlags({ remote: location.remote, hybrid: location.hybrid }) ??
      detectRemotePolicy(title, description),
    contractType,
    contractLabel: cleanString(contractField) ?? cleanString(posting.typeOfEmployment?.label),
    // Pas de rémunération structurée dans l'API publique : seule une mention
    // explicite du texte est lue, jamais estimée.
    salary: salaryFromDescription(description),
    sector: company.sector,
    seniority:
      posting.experienceLevel?.id === "not_applicable"
        ? null
        : cleanString(posting.experienceLevel?.label),
    publishedAt: parseDate(posting.releasedDate),
  };
}
