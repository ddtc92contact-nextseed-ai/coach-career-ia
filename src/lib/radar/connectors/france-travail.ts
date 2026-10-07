import { isValidPoint } from "@/lib/geo/distance";
import type { HttpClient } from "../http";
import {
  detectContractType,
  detectRemotePolicy,
  normalizeUrl,
  parseFranceTravailLocation,
} from "../normalize";
import { parseSalaryText, withComplements } from "../salary";
import { cleanString, parseDate } from "../text";
import type { ContractType, Connector, NormalizedOffer } from "../types";

/**
 * API France Travail « Offres d'emploi v2 » (accès partenaire, OAuth2
 * client credentials) : https://francetravail.io/data/api/offres-emploi
 *
 * Limites documentées : 150 offres par requête (`range=0-149`), index de
 * départ ≤ 3000 et index de fin ≤ 3149 par recherche. Au-delà, la collecte
 * est marquée incomplète et aucune offre n'est fermée.
 */
export const FT_TOKEN_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
export const FT_SEARCH_URL =
  "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
export const FT_SCOPE = "api_offresdemploiv2 o2dsoffre";
export const FT_PAGE_SIZE = 150;
export const FT_MAX_INDEX = 3149;

export type FranceTravailCriteria = {
  romeCodes: string[];
  keywords: string | null;
  /** Départements (codes), 5 au plus par requête. */
  departments: string[];
  /** Plafond d'offres par recherche (≤ 3150). */
  maxResultsPerSearch: number;
  /** Taille de page (≤ 150, la valeur documentée par défaut). */
  pageSize?: number;
};

export type FranceTravailCredentials = { clientId: string; clientSecret: string };

export type FranceTravailOffer = {
  id: string;
  intitule?: string;
  description?: string;
  dateCreation?: string;
  dateActualisation?: string;
  lieuTravail?: {
    libelle?: string;
    codePostal?: string;
    /** Code commune INSEE. */
    commune?: string;
    latitude?: number;
    longitude?: number;
  } | null;
  entreprise?: { nom?: string; url?: string } | null;
  typeContrat?: string;
  typeContratLibelle?: string;
  natureContrat?: string;
  experienceExige?: string;
  experienceLibelle?: string;
  salaire?: {
    libelle?: string;
    commentaire?: string;
    complement1?: string;
    complement2?: string;
  } | null;
  alternance?: boolean;
  secteurActiviteLibelle?: string;
  appellationlibelle?: string;
  origineOffre?: {
    origine?: string;
    urlOrigine?: string;
    partenaires?: { nom?: string; url?: string }[];
  } | null;
  // `contact` (nom, téléphone, courriel du recruteur) est volontairement ignoré.
};

type SearchResponse = { resultats?: FranceTravailOffer[] };

const CONTRACTS: Record<string, ContractType> = {
  CDI: "CDI",
  CDD: "CDD",
  MIS: "TEMPORARY",
  SAI: "TEMPORARY",
  LIB: "FREELANCE",
  FRA: "OTHER",
  CCE: "OTHER",
  REP: "OTHER",
  DIN: "CDI",
  DDI: "CDD",
};

/** Construit les recherches : départements par lots de 5 (limite de l'API). */
export function buildSearches(criteria: FranceTravailCriteria): URLSearchParams[] {
  const chunks: string[][] = [];
  for (let i = 0; i < criteria.departments.length; i += 5) {
    chunks.push(criteria.departments.slice(i, i + 5));
  }
  if (chunks.length === 0) chunks.push([]);
  return chunks.map((departments) => {
    const params = new URLSearchParams();
    if (criteria.romeCodes.length > 0) params.set("codeROME", criteria.romeCodes.join(","));
    if (criteria.keywords) params.set("motsCles", criteria.keywords);
    if (departments.length > 0) params.set("departement", departments.join(","));
    params.set("sort", "1");
    return params;
  });
}

/** « offres 0-149/1234 » → 1234. */
export function totalFromContentRange(header: string | null): number | null {
  const m = /\/\s*(\d+)\s*$/.exec(header ?? "");
  return m ? Number(m[1]) : null;
}

class TokenProvider {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly credentials: FranceTravailCredentials,
    private readonly now: () => Date,
  ) {}

  async get(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now().getTime()) return this.token.value;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope: FT_SCOPE,
    });
    const res = await this.http.request(FT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    const json = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("Jeton France Travail absent de la réponse");
    const ttl = Math.max(60, (json.expires_in ?? 1499) - 60) * 1000;
    this.token = { value: json.access_token, expiresAt: this.now().getTime() + ttl };
    return json.access_token;
  }
}

export function franceTravailConnector(
  credentials: FranceTravailCredentials,
  criteria: FranceTravailCriteria,
): Connector<FranceTravailOffer> {
  return {
    source: "france_travail",
    key: "france_travail",
    async fetch({ http, now }) {
      const tokens = new TokenProvider(http, credentials, now);
      const limit = Math.min(Math.max(1, criteria.maxResultsPerSearch), FT_MAX_INDEX + 1);
      const pageSize = Math.min(Math.max(1, criteria.pageSize ?? FT_PAGE_SIZE), FT_PAGE_SIZE);
      const items: FranceTravailOffer[] = [];
      let complete = true;

      for (const params of buildSearches(criteria)) {
        for (let start = 0; start < limit; start += pageSize) {
          const end = Math.min(start + pageSize, limit) - 1;
          params.set("range", `${start}-${end}`);
          const { status, headers, data } = await http.getJson<SearchResponse>(
            `${FT_SEARCH_URL}?${params.toString()}`,
            { headers: { Authorization: `Bearer ${await tokens.get()}` } },
          );
          if (status === 204 || !data) break;
          const page = data.resultats ?? [];
          items.push(...page);
          const total = totalFromContentRange(headers.get("content-range"));
          const fetchedUpTo = start + page.length;
          if (total === null || fetchedUpTo >= total || page.length === 0) break;
          if (end + 1 >= limit) {
            // Plafond atteint alors que d'autres offres existent.
            complete = false;
            break;
          }
        }
      }
      return { items, complete };
    },
    map: mapFranceTravailOffer,
  };
}

export function franceTravailOfferUrl(id: string): string {
  return `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(id)}`;
}

export function mapFranceTravailOffer(offer: FranceTravailOffer): NormalizedOffer | null {
  const title = cleanString(offer.intitule);
  if (!offer.id || !title) return null;
  const description = offer.description?.trim() ?? "";
  const url = franceTravailOfferUrl(offer.id);

  // Offre relayée depuis un site partenaire / carrière : son URL d'origine sert au dédoublonnage.
  const origin =
    cleanString(offer.origineOffre?.partenaires?.[0]?.url) ??
    cleanString(offer.origineOffre?.urlOrigine);
  const canonicalUrl =
    origin && !/francetravail\.fr|pole-emploi\.fr/.test(normalizeUrl(origin)) ? origin : null;

  const code = cleanString(offer.typeContrat)?.toUpperCase() ?? "";
  let contractType: ContractType = CONTRACTS[code] ?? "UNKNOWN";
  if (offer.alternance || detectContractType(offer.natureContrat) === "APPRENTICESHIP") {
    contractType = "APPRENTICESHIP";
  } else if (contractType === "UNKNOWN") {
    contractType = detectContractType(offer.typeContratLibelle, title);
  }

  const s = offer.salaire;
  const salary = withComplements(parseSalaryText(s?.libelle) ?? parseSalaryText(s?.commentaire), [
    cleanString(s?.complement1),
    cleanString(s?.complement2),
  ]);

  return {
    sourceId: offer.id,
    url,
    canonicalUrl,
    title,
    companyName: cleanString(offer.entreprise?.nom),
    description,
    location: parseFranceTravailLocation(offer.lieuTravail?.libelle, offer.lieuTravail?.codePostal),
    // Coordonnées et code commune fournis par l'API : utilisés tels quels.
    coordinates: isValidPoint(offer.lieuTravail)
      ? { latitude: offer.lieuTravail.latitude, longitude: offer.lieuTravail.longitude }
      : null,
    postalCode: cleanString(offer.lieuTravail?.codePostal),
    cityCode: cleanString(offer.lieuTravail?.commune),
    remotePolicy: detectRemotePolicy(title, description),
    contractType,
    contractLabel: cleanString(offer.typeContratLibelle),
    salary,
    sector: cleanString(offer.secteurActiviteLibelle),
    seniority:
      offer.experienceExige === "D" ? "Débutant accepté" : cleanString(offer.experienceLibelle),
    publishedAt: parseDate(offer.dateCreation),
  };
}
