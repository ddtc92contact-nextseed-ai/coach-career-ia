import type { AtsType } from "@/generated/prisma/enums";
import { boardPath } from "./connectors/ats";
import { ASHBY_API } from "./connectors/ashby";
import { GREENHOUSE_API } from "./connectors/greenhouse";
import { LEVER_API, LEVER_API_EU } from "./connectors/lever";
import { recruiteeOffersUrl } from "./connectors/recruitee";
import { SMARTRECRUITERS_API } from "./connectors/smartrecruiters";
import { WORKABLE_WIDGET_API } from "./connectors/workable";
import { HttpError, type HttpClient } from "./http";

/**
 * « Mes entreprises à suivre » : reconnaissance d'un job board ATS public à
 * partir de l'URL d'une page carrières, puis validation par UNE requête à
 * l'API publique du board. Seuls les ATS dont le radar a un connecteur sont
 * acceptés : aucun site carrière arbitraire n'est collecté (pas de scraping).
 */

export type AtsBoard = {
  atsType: AtsType;
  boardToken: string;
  /** Lever : « eu » pour api.eu.lever.co. */
  atsRegion: string | null;
};

export const SUPPORTED_ATS: AtsType[] = [
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
  "SMARTRECRUITERS",
  "RECRUITEE",
  "WORKABLE",
];

/** Modèle d'URL de page carrières par ATS (aide affichée ; `{slug}` = nom de l'entreprise). */
export const ATS_URL_EXAMPLES: Record<AtsType, string> = {
  GREENHOUSE: "boards.greenhouse.io/{slug}",
  LEVER: "jobs.lever.co/{slug}",
  ASHBY: "jobs.ashbyhq.com/{slug}",
  SMARTRECRUITERS: "careers.smartrecruiters.com/{slug}",
  RECRUITEE: "{slug}.recruitee.com",
  WORKABLE: "apply.workable.com/{slug}",
};

export const ATS_LABELS: Record<AtsType, string> = {
  GREENHOUSE: "Greenhouse",
  LEVER: "Lever",
  ASHBY: "Ashby",
  SMARTRECRUITERS: "SmartRecruiters",
  RECRUITEE: "Recruitee",
  WORKABLE: "Workable",
};

const TOKEN = /^[A-Za-z0-9._-]{1,100}$/;
/** Segments qui ne sont pas des jetons de board (pages techniques des ATS). */
const RESERVED = new Set([
  "api",
  "v0",
  "v1",
  "embed",
  "jobs",
  "postings",
  "posting-api",
  "job-board",
  "boards",
  "companies",
  "widget",
  "accounts",
  "j",
  "www",
  "app",
  "careers",
  "help",
  "static",
]);

function token(value: string | undefined | null): string | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value).trim();
  } catch {
    return null;
  }
  if (!TOKEN.test(decoded) || RESERVED.has(decoded.toLowerCase())) return null;
  return decoded;
}

/** Normalise une saisie en URL (le schéma est facultatif). `null` si ce n'en est pas une. */
export function parseCareersUrl(input: string): URL | null {
  const value = input.trim();
  if (!value || /\s/.test(value) || value.length > 500) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

/** Vrai si la saisie ressemble à une URL (sinon : recherche par nom). */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim();
  return (
    /^https?:\/\//i.test(value) || (/^[^\s/]+\.[a-z]{2,}(\/|$)/i.test(value) && !/\s/.test(value))
  );
}

/**
 * ATS et jeton de board d'une URL de page carrières (ou de l'API publique
 * correspondante). `null` : site non pris en charge.
 */
export function detectAtsBoard(input: string): AtsBoard | null {
  const url = parseCareersUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];
  const board = (
    atsType: AtsType,
    value: string | null | undefined,
    atsRegion: string | null = null,
  ) => {
    const t = token(value);
    return t ? { atsType, boardToken: t, atsRegion } : null;
  };

  switch (host) {
    // Greenhouse : boards.greenhouse.io/<jeton>, job-boards.greenhouse.io/<jeton>,
    // widget embarqué (?for=<jeton>) et API publique.
    case "boards.greenhouse.io":
    case "job-boards.greenhouse.io":
      if (first === "embed") return board("GREENHOUSE", url.searchParams.get("for"));
      return board("GREENHOUSE", first);
    case "boards-api.greenhouse.io":
      return segments[0] === "v1" && segments[1] === "boards"
        ? board("GREENHOUSE", segments[2])
        : null;
    case "jobs.lever.co":
      return board("LEVER", first);
    case "jobs.eu.lever.co":
      return board("LEVER", first, "eu");
    case "api.lever.co":
    case "api.eu.lever.co":
      return segments[0] === "v0" && segments[1] === "postings"
        ? board("LEVER", segments[2], host === "api.eu.lever.co" ? "eu" : null)
        : null;
    case "jobs.ashbyhq.com":
      return board("ASHBY", first);
    case "api.ashbyhq.com":
      return segments[0] === "posting-api" && segments[1] === "job-board"
        ? board("ASHBY", segments[2])
        : null;
    case "careers.smartrecruiters.com":
    case "jobs.smartrecruiters.com":
      return board("SMARTRECRUITERS", first);
    case "api.smartrecruiters.com":
      return segments[0] === "v1" && segments[1] === "companies"
        ? board("SMARTRECRUITERS", segments[2])
        : null;
    case "apply.workable.com":
      if (first === "api") {
        return segments[1] === "v1" && segments[2] === "widget" && segments[3] === "accounts"
          ? board("WORKABLE", segments[4])
          : null;
      }
      return board("WORKABLE", first);
  }

  // Recruitee : <jeton>.recruitee.com ; Workable (ancien format) : <jeton>.workable.com.
  const sub = /^([a-z0-9-]+)\.(recruitee|workable)\.com$/.exec(host);
  if (sub) {
    const [, name, ats] = sub;
    if (ats === "recruitee") {
      const found = board("RECRUITEE", name);
      return found ? { ...found, boardToken: found.boardToken.toLowerCase() } : null;
    }
    return board("WORKABLE", name);
  }
  return null;
}

/** Nom lisible tiré du jeton (« la-belle-boite » → « La Belle Boite »). */
export function nameFromToken(boardToken: string): string {
  return boardToken
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type BoardProbe =
  | { ok: true; openOffers: number; companyName: string | null }
  | { ok: false; reason: "notFound" | "unreachable" };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Valide un board par une seule requête à son API publique (mêmes règles de
 * politesse que le radar : User-Agent avec contact, robots.txt, débit par
 * hôte). Renvoie le nombre d'offres ouvertes et, si l'API le donne, le nom de
 * l'entreprise.
 */
export async function probeBoard(http: HttpClient, board: AtsBoard): Promise<BoardProbe> {
  const path = boardPath(board.boardToken);
  try {
    switch (board.atsType) {
      case "GREENHOUSE": {
        const { data } = await http.getJson<{ jobs?: { company_name?: string }[] }>(
          `${GREENHOUSE_API}/${path}/jobs`,
        );
        if (!data || !Array.isArray(data.jobs)) return { ok: false, reason: "notFound" };
        return {
          ok: true,
          openOffers: data.jobs.length,
          companyName: str(data.jobs[0]?.company_name),
        };
      }
      case "LEVER": {
        const base = board.atsRegion === "eu" ? LEVER_API_EU : LEVER_API;
        const { data } = await http.getJson<unknown[]>(`${base}/${path}?mode=json`);
        if (!Array.isArray(data)) return { ok: false, reason: "notFound" };
        return { ok: true, openOffers: data.length, companyName: null };
      }
      case "ASHBY": {
        const { data } = await http.getJson<{ jobs?: unknown[] }>(`${ASHBY_API}/${path}`);
        if (!data || !Array.isArray(data.jobs)) return { ok: false, reason: "notFound" };
        return { ok: true, openOffers: data.jobs.length, companyName: null };
      }
      case "SMARTRECRUITERS": {
        const { data } = await http.getJson<{
          totalFound?: number;
          content?: { company?: { name?: string } | null }[];
        }>(`${SMARTRECRUITERS_API}/${path}/postings?limit=1&offset=0`, { robots: true });
        if (!data || !Array.isArray(data.content)) return { ok: false, reason: "notFound" };
        const total = typeof data.totalFound === "number" ? data.totalFound : data.content.length;
        // L'API répond « 0 offre » pour un jeton inconnu : pas de quoi le distinguer
        // d'un board vide, sinon par le nom de l'entreprise quand il y a des offres.
        return { ok: true, openOffers: total, companyName: str(data.content[0]?.company?.name) };
      }
      case "RECRUITEE": {
        const { data } = await http.getJson<{ offers?: { company_name?: string }[] }>(
          recruiteeOffersUrl(board.boardToken),
          { robots: true },
        );
        if (!data || !Array.isArray(data.offers)) return { ok: false, reason: "notFound" };
        return {
          ok: true,
          openOffers: data.offers.length,
          companyName: str(data.offers[0]?.company_name),
        };
      }
      case "WORKABLE": {
        const { data } = await http.getJson<{ name?: string; jobs?: unknown[] }>(
          `${WORKABLE_WIDGET_API}/${path}`,
          { robots: true },
        );
        if (!data || !Array.isArray(data.jobs)) return { ok: false, reason: "notFound" };
        return { ok: true, openOffers: data.jobs.length, companyName: str(data.name) };
      }
    }
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 410)) {
      return { ok: false, reason: "notFound" };
    }
    // JSON illisible : ce n'est pas un board. robots.txt, réseau, 5xx : injoignable.
    if (error instanceof SyntaxError) return { ok: false, reason: "notFound" };
    return { ok: false, reason: "unreachable" };
  }
  return { ok: false, reason: "notFound" };
}
