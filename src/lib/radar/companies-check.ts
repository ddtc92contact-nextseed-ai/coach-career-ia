import { z } from "zod";
import { normalizeText, termPattern } from "@/lib/matching/text";
import type { CompanyConfig } from "./companies";
import type { AtsCompany } from "./connectors/ats";
import { smartRecruitersConnector } from "./connectors/smartrecruiters";
import { HttpError, RobotsDisallowedError, type HttpClient } from "./http";
import { atsConnector } from "./job";
import type { AtsType } from "@/generated/prisma/enums";

/**
 * Vérification de la liste de référence du radar (`scripts/radar-companies-check.ts`,
 * lancée à la main, jamais en CI) : chaque board candidat est interrogé UNE
 * fois via son API publique, avec le client HTTP du radar (User-Agent avec
 * contact, robots.txt, `RADAR_MIN_INTERVAL_MS`). Seuls les boards qui
 * répondent, publient au moins une offre en France ou dans l'UE et dont le nom
 * correspond entrent dans `config/radar-companies.json` : aucun jeton deviné.
 */

const ATS_TYPES: Record<CompanyConfig[number]["ats"], AtsType> = {
  greenhouse: "GREENHOUSE",
  lever: "LEVER",
  ashby: "ASHBY",
  smartrecruiters: "SMARTRECRUITERS",
  recruitee: "RECRUITEE",
  workable: "WORKABLE",
};

/** Pays de l'Union européenne (ISO-2). */
export const EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

/** Candidat : même forme qu'une entrée de la liste de référence, slug facultatif. */
export const candidateSchema = z.array(
  z.object({
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    name: z.string().min(1),
    website: z.url().optional(),
    sector: z.string().optional(),
    ats: z.enum(["greenhouse", "lever", "ashby", "smartrecruiters", "recruitee", "workable"]),
    boardToken: z.string().regex(/^[A-Za-z0-9._-]+$/),
    region: z.enum(["eu"]).optional(),
  }),
);
export type Candidate = z.infer<typeof candidateSchema>[number];

export type CheckStatus =
  /** Board public qui répond, avec au moins une offre en France ou dans l'UE. */
  | "valid"
  /** Jeton inconnu de l'ATS (404, réponse vide ou illisible). */
  | "unknownToken"
  /** Board actif, mais aucune offre en France ni dans l'UE. */
  | "noEuOffers"
  /** L'ATS donne un autre nom d'entreprise : ce jeton appartient à quelqu'un d'autre. */
  | "nameMismatch"
  /** robots.txt, erreur serveur ou réseau : à revérifier plus tard. */
  | "unreachable";

export type CheckResult = {
  candidate: Candidate;
  status: CheckStatus;
  offers: number;
  fr: number;
  eu: number;
  /** Offres sans pays connu (gardées par le radar). */
  unknownCountry: number;
  /** Nom donné par l'ATS, quand il en donne un. */
  atsName: string | null;
  /** Quelques intitulés d'offres (aide à l'attribution du secteur). */
  titles: string[];
  /** `confirmed` : nom de l'ATS ou nom cité dans les annonces ; `unverified` : ni l'un ni l'autre. */
  identity: "confirmed" | "unverified" | "mismatch";
  error: string | null;
};

export function slugify(name: string): string {
  return normalizeText(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Mentions juridiques et génériques ignorées dans la comparaison des noms. */
const NAME_NOISE = new Set(
  "sas sasu sa se sarl gmbh ag ab as aps oy bv b v nv srl spa llc ltd limited inc corp co plc holding holdings group groupe france the".split(
    " ",
  ),
);

/** Forme comparable d'un nom d'entreprise (« Back Market SAS » → « backmarket »). */
function nameKey(name: string): string {
  return normalizeText(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !NAME_NOISE.has(word))
    .join("");
}

/**
 * Même entreprise : noms identiques hors mentions juridiques, ou nom de
 * l'ATS qui prolonge le nom attendu (« Mistertemp' group », « Doctolib SAS »).
 */
export function sameName(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return x === y || (short.length >= 5 && long.startsWith(short));
}

/** Le nom est cité comme terme entier (« Back Market » ou « BackMarket ») dans le texte normalisé. */
function mentions(text: string, name: string): boolean {
  const phrase = normalizeText(name);
  const compact = nameKey(name);
  return [phrase, compact].some((term) => term.length >= 3 && termPattern(term).test(text));
}

/** Nom d'entreprise porté par une offre brute (Greenhouse, Recruitee, SmartRecruiters). */
function rawCompanyName(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { company_name?: unknown; company?: { name?: unknown } | null };
  const name = typeof r.company_name === "string" ? r.company_name : r.company?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function toCompany(candidate: Candidate): AtsCompany {
  return {
    slug: candidate.slug ?? slugify(candidate.name),
    name: candidate.name,
    sector: candidate.sector ?? null,
    atsType: ATS_TYPES[candidate.ats],
    boardToken: candidate.boardToken,
    atsRegion: candidate.region ?? null,
  };
}

/** Vérifie un candidat (une collecte de son board, sans écriture en base). */
export async function checkCandidate(http: HttpClient, candidate: Candidate): Promise<CheckResult> {
  const company = toCompany(candidate);
  const result: CheckResult = {
    candidate,
    status: "unknownToken",
    offers: 0,
    fr: 0,
    eu: 0,
    unknownCountry: 0,
    atsName: null,
    titles: [],
    identity: "unverified",
    error: null,
  };
  // SmartRecruiters : la liste suffit (le pays y figure), sans relire chaque offre.
  const connector =
    company.atsType === "SMARTRECRUITERS"
      ? smartRecruitersConnector(company, { details: false })
      : atsConnector(company);

  let items: unknown[];
  try {
    items = (await connector.fetch({ http, now: () => new Date() })).items;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 410)) {
      return { ...result, error: `HTTP ${error.status}` };
    }
    if (error instanceof SyntaxError) return { ...result, error: "réponse illisible" };
    if (error instanceof HttpError || error instanceof RobotsDisallowedError) {
      return { ...result, status: "unreachable", error: error.message };
    }
    // « Réponse … inattendue » des connecteurs : pas un board.
    return { ...result, error: error instanceof Error ? error.message : String(error) };
  }

  // Nom donné par l'ATS (le plus fréquent) ; sinon, le nom doit être cité dans une annonce.
  const names = new Map<string, number>();
  let mentioned = false;
  for (const raw of items) {
    const name = rawCompanyName(raw);
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
    let offer;
    try {
      offer = connector.map(raw);
    } catch {
      offer = null;
    }
    if (!offer) continue;
    result.offers++;
    if (result.titles.length < 3) result.titles.push(offer.title);
    const country = offer.location.country;
    if (!country) result.unknownCountry++;
    else if (country === "FR") result.fr++;
    if (country && EU_COUNTRIES.has(country)) result.eu++;
    if (!mentioned) {
      mentioned = mentions(normalizeText(`${offer.title} ${offer.description}`), candidate.name);
    }
  }
  result.atsName = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  if (result.offers === 0) {
    // SmartRecruiters répond « 0 offre » pour un jeton inconnu : indiscernable d'un board vide.
    return { ...result, status: items.length === 0 ? "unknownToken" : "noEuOffers" };
  }
  result.identity = result.atsName
    ? sameName(result.atsName, candidate.name) || mentioned
      ? "confirmed"
      : "mismatch"
    : mentioned
      ? "confirmed"
      : "unverified";
  if (result.identity === "mismatch") return { ...result, status: "nameMismatch" };
  return { ...result, status: result.eu > 0 ? "valid" : "noEuOffers" };
}

/** Vérifie les candidats, `concurrency` à la fois (le débit par hôte reste celui du client). */
export async function checkCandidates(
  http: HttpClient,
  candidates: Candidate[],
  options: { concurrency?: number; onResult?: (result: CheckResult, done: number) => void } = {},
): Promise<CheckResult[]> {
  const results: CheckResult[] = new Array(candidates.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < candidates.length) {
      const index = next++;
      results[index] = await checkCandidate(http, candidates[index]!);
      options.onResult?.(results[index]!, ++done);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 1) }, worker));
  return results;
}

export type CheckSummary = Record<
  CompanyConfig[number]["ats"],
  Record<CheckStatus, number> & { total: number }
>;

export function summarizeChecks(results: CheckResult[]): CheckSummary {
  const summary = {} as CheckSummary;
  for (const ats of Object.keys(ATS_TYPES) as CompanyConfig[number]["ats"][]) {
    summary[ats] = {
      total: 0,
      valid: 0,
      unknownToken: 0,
      noEuOffers: 0,
      nameMismatch: 0,
      unreachable: 0,
    };
  }
  for (const r of results) {
    summary[r.candidate.ats].total++;
    summary[r.candidate.ats][r.status]++;
  }
  return summary;
}

/**
 * Entrées de la liste de référence pour les candidats valides, ajoutées à
 * `existing` sans doublon (même slug ou même board) ; l'ordre est conservé.
 */
export function mergeAccepted(
  existing: CompanyConfig,
  results: CheckResult[],
): { config: CompanyConfig; added: number } {
  const config = [...existing];
  const slugs = new Set(config.map((c) => c.slug));
  const boards = new Set(config.map((c) => `${c.ats}:${c.boardToken.toLowerCase()}`));
  let added = 0;
  for (const { candidate: c, status } of results) {
    if (status !== "valid") continue;
    const board = `${c.ats}:${c.boardToken.toLowerCase()}`;
    if (boards.has(board)) continue;
    let slug = c.slug ?? slugify(c.name);
    for (let i = 2; slugs.has(slug); i++) slug = `${c.slug ?? slugify(c.name)}-${i}`;
    config.push({
      slug,
      name: c.name,
      ...(c.website ? { website: c.website } : {}),
      ...(c.sector ? { sector: c.sector } : {}),
      ats: c.ats,
      boardToken: c.boardToken,
      ...(c.region ? { region: c.region } : {}),
      active: true,
    });
    slugs.add(slug);
    boards.add(board);
    added++;
  }
  return { config, added };
}
