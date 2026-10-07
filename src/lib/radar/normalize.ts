import { foldText } from "./text";
import type { ContractType, Location, RemotePolicy } from "./types";

// --- Télétravail -------------------------------------------------------------

const FULL_REMOTE =
  /\b(?:full[\s-]?remote|fully remote|100\s?%\s?(?:en\s)?(?:teletravail|remote|a distance)|teletravail (?:total|complet|integral)|remote only)\b/;
const HYBRID =
  /\b(?:(?:travail|mode|organisation|format|rythme|en) hybride|hybrid (?:work|working|model|mode|policy|setup|role|position|schedule)|(?:role|position|job) is hybrid|teletravail (?:partiel|possible|occasionnel|autorise)|\d\s?(?:jours?|j) (?:de )?teletravail|teletravail \d|\d days? (?:of )?remote|remote \d days?)\b/;
const ONSITE =
  /\b(?:pas de teletravail|sans teletravail|teletravail (?:non possible|impossible)|100\s?%\s?(?:presentiel|sur site|on[\s-]?site)|on[\s-]?site only)\b/;

/**
 * Politique de télétravail déduite d'un texte. Seules des mentions explicites
 * sont retenues ; sinon `UNKNOWN`.
 */
export function detectRemotePolicy(...texts: (string | null | undefined)[]): RemotePolicy {
  const text = foldText(texts.filter(Boolean).join(" \n "))
    // foldText retire « % » : on le rétablit pour les motifs « 100 % ».
    .replace(/\b100 (?=teletravail|remote|presentiel|sur site|en|a distance|on)/g, "100% ");
  if (ONSITE.test(text)) return "ONSITE";
  if (FULL_REMOTE.test(text)) return "FULL_REMOTE";
  if (HYBRID.test(text)) return "HYBRID";
  return "UNKNOWN";
}

/** Valeurs structurées des ATS (`workplaceType`). */
export function remoteFromWorkplace(value: unknown): RemotePolicy | null {
  if (typeof value !== "string") return null;
  switch (value.toLowerCase().replace(/[\s_-]/g, "")) {
    case "onsite":
      return "ONSITE";
    case "hybrid":
      return "HYBRID";
    case "remote":
      return "FULL_REMOTE";
    default:
      return null;
  }
}

// --- Contrat -----------------------------------------------------------------

const CONTRACT_PATTERNS: [RegExp, ContractType][] = [
  [
    /\b(?:alternance|alternant|apprenti(?:ssage)?|apprenticeship|professionnalisation|work[\s-]?study)\b/,
    "APPRENTICESHIP",
  ],
  [/\b(?:stage|stagiaire|intern(?:ship)?|internat)\b/, "INTERNSHIP"],
  [/\b(?:freelance|independant|contractor|portage|mission freelance)\b/, "FREELANCE"],
  [/\b(?:interim|interimaire|saisonnier|temporary|temp)\b/, "TEMPORARY"],
  [/\b(?:cdd|fixed[\s-]?term)\b/, "CDD"],
  [/\b(?:cdi|permanent)\b/, "CDI"],
];

/** Type de contrat repéré dans un libellé (intitulé, « commitment »…). */
export function detectContractType(...texts: (string | null | undefined)[]): ContractType {
  const text = foldText(texts.filter(Boolean).join(" "));
  for (const [re, type] of CONTRACT_PATTERNS) if (re.test(text)) return type;
  return "UNKNOWN";
}

// --- Lieu --------------------------------------------------------------------

const COUNTRIES: Record<string, string> = {
  france: "FR",
  fr: "FR",
  germany: "DE",
  allemagne: "DE",
  deutschland: "DE",
  spain: "ES",
  espagne: "ES",
  italy: "IT",
  italie: "IT",
  belgium: "BE",
  belgique: "BE",
  netherlands: "NL",
  "pays bas": "NL",
  "united kingdom": "GB",
  uk: "GB",
  "royaume uni": "GB",
  england: "GB",
  ireland: "IE",
  portugal: "PT",
  switzerland: "CH",
  suisse: "CH",
  luxembourg: "LU",
  "united states": "US",
  usa: "US",
  us: "US",
  "etats unis": "US",
  canada: "CA",
  singapore: "SG",
  japan: "JP",
  "south korea": "KR",
  australia: "AU",
  poland: "PL",
  austria: "AT",
  sweden: "SE",
  denmark: "DK",
  senegal: "SN",
  morocco: "MA",
  maroc: "MA",
  tunisia: "TN",
  tunisie: "TN",
};

const FRENCH_CITIES = new Set([
  "paris",
  "lyon",
  "marseille",
  "toulouse",
  "nantes",
  "bordeaux",
  "lille",
  "montpellier",
  "rennes",
  "strasbourg",
  "nice",
  "grenoble",
  "levallois perret",
  "la defense",
  "boulogne billancourt",
  "issy les moulineaux",
  "neuilly sur seine",
  "puteaux",
  "courbevoie",
  "saint denis",
  "sophia antipolis",
]);

const REMOTE_WORDS = /^(?:remote|teletravail|anywhere|anywhere in .*|full remote|hybrid)$/;

/** Code ISO d'un nom de pays (anglais ou français), sinon `null`. */
export function countryCode(name: string | null | undefined): string | null {
  if (!name) return null;
  const folded = foldText(name);
  if (/^[a-z]{2}$/.test(folded) && Object.values(COUNTRIES).includes(folded.toUpperCase())) {
    return folded.toUpperCase();
  }
  return COUNTRIES[folded] ?? null;
}

/** « Paris 15e Arrondissement » → « Paris », « Lyon 3e » → « Lyon », sans CEDEX. */
export function cleanCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const cleaned = city
    .replace(/\s+\d{1,2}(?:e|er|ème)?(?:\s+arrondissement)?$/i, "")
    .replace(/\s+cedex(?:\s+\d+)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  // Les sources renvoient parfois les communes en capitales.
  return cleaned === cleaned.toUpperCase()
    ? cleaned
        .toLowerCase()
        .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
    : cleaned;
}

export type ParsedLocation = Location & { remote: boolean };

/**
 * Lit un libellé de lieu libre d'ATS : « Paris, France », « France, Paris »,
 * « France, Remote », « Paris ». Plusieurs lieux séparés par « ; » ou « | » :
 * le premier dans un pays préféré l'emporte.
 */
export function parseLocationLabel(
  label: string | null | undefined,
  preferredCountries: string[] = ["FR"],
): ParsedLocation {
  const empty: ParsedLocation = { city: null, region: null, country: null, remote: false };
  if (!label) return empty;
  const segments = label
    .split(/[;|]| \/ /)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseSegment);
  if (segments.length === 0) return empty;
  const preferred = segments.find((s) => s.country && preferredCountries.includes(s.country));
  const chosen = preferred ?? segments[0]!;
  return { ...chosen, remote: segments.every((s) => s.remote) };
}

function parseSegment(segment: string): ParsedLocation {
  const parts = segment
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let country: string | null = null;
  let remote = false;
  const rest: string[] = [];
  for (const part of parts) {
    const code = countryCode(part);
    if (code && !country) country = code;
    else if (REMOTE_WORDS.test(foldText(part))) remote = true;
    else if (/^(?:anywhere in|remote\s*[-–(]?\s*)/i.test(part)) {
      remote = true;
      const inner = countryCode(
        part.replace(/^(?:anywhere in|remote\s*[-–(]?\s*)/i, "").replace(/\)$/, ""),
      );
      if (inner && !country) country = inner;
    } else rest.push(part);
  }
  const city = cleanCity(rest[0]) ?? null;
  const region = rest.length > 1 ? rest[1]! : null;
  if (!country && city && FRENCH_CITIES.has(foldText(city))) country = "FR";
  return { city, region, country, remote };
}

// Départements français → régions (pour les libellés France Travail « 75 - Paris »).
const REGION_DEPARTMENTS: Record<string, string[]> = {
  "Île-de-France": ["75", "77", "78", "91", "92", "93", "94", "95"],
  "Auvergne-Rhône-Alpes": ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
  "Bourgogne-Franche-Comté": ["21", "25", "39", "58", "70", "71", "89", "90"],
  Bretagne: ["22", "29", "35", "56"],
  "Centre-Val de Loire": ["18", "28", "36", "37", "41", "45"],
  Corse: ["2A", "2B"],
  "Grand Est": ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"],
  "Hauts-de-France": ["02", "59", "60", "62", "80"],
  Normandie: ["14", "27", "50", "61", "76"],
  "Nouvelle-Aquitaine": ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"],
  Occitanie: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
  "Pays de la Loire": ["44", "49", "53", "72", "85"],
  "Provence-Alpes-Côte d'Azur": ["04", "05", "06", "13", "83", "84"],
  Guadeloupe: ["971"],
  Martinique: ["972"],
  Guyane: ["973"],
  "La Réunion": ["974"],
  Mayotte: ["976"],
};

const DEPARTMENT_REGION = new Map(
  Object.entries(REGION_DEPARTMENTS).flatMap(([region, codes]) =>
    codes.map((code) => [code, region] as const),
  ),
);

/**
 * Harmonise la région : nom officiel pour la France (« Ile de France » →
 * « Île-de-France »), et rien quand la source répète simplement la ville.
 */
export function tidyLocation(location: Location): Location {
  let region = location.region;
  if (region && location.city && foldText(region) === foldText(location.city)) region = null;
  if (region && location.country === "FR") {
    const folded = foldText(region);
    region = Object.keys(REGION_DEPARTMENTS).find((r) => foldText(r) === folded) ?? region;
  }
  return { ...location, region };
}

export function regionOfDepartment(code: string | null | undefined): string | null {
  return code ? (DEPARTMENT_REGION.get(code.toUpperCase()) ?? null) : null;
}

/**
 * Libellé de lieu France Travail : « 75 - Paris 15e Arrondissement »,
 * « 69 - LYON 03 », ou une région seule (« Ile-de-France »).
 */
export function parseFranceTravailLocation(
  libelle: string | null | undefined,
  postalCode?: string | null,
): Location {
  if (!libelle) return { city: null, region: null, country: "FR" };
  const m = /^\s*(\d{2,3}|2[AB])\s*-\s*(.+)$/i.exec(libelle);
  const dept =
    m?.[1] ?? (postalCode ? postalCode.slice(0, postalCode.startsWith("97") ? 3 : 2) : null);
  const region = regionOfDepartment(dept);
  if (!m) {
    const folded = foldText(libelle);
    const regionName = Object.keys(REGION_DEPARTMENTS).find((r) => foldText(r) === folded);
    return { city: null, region: regionName ?? region, country: "FR" };
  }
  return { city: cleanCity(m[2]), region, country: "FR" };
}

// --- Déduplication -----------------------------------------------------------

const TITLE_NOISE =
  /\b(?:h f|f h|h f x|f h x|m f|f m|m f d|m w d|x f|hf|fh|h\/f|cdi|cdd|stage|alternance|freelance|internship|full time|part time|temps plein|temps partiel)\b/g;
const COMPANY_SUFFIX =
  /\b(?:sas|sasu|sa|sarl|eurl|inc|ltd|llc|gmbh|group|groupe|france|technologies)\b/g;

export function normalizeCompany(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = foldText(name).replace(COMPANY_SUFFIX, " ").replace(/\s+/g, " ").trim();
  return key || null;
}

/** Intitulé réduit à ses mots significatifs, triés (ordre indifférent). */
export function normalizeTitle(title: string, location?: Location): string {
  const dropped = new Set(
    [location?.city, location?.region, location?.country === "FR" ? "france" : null]
      .filter((v): v is string => Boolean(v))
      .flatMap((v) => foldText(v).split(" ")),
  );
  const words = foldText(title)
    .replace(TITLE_NOISE, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !dropped.has(w));
  return [...new Set(words)].sort().join(" ");
}

export function dedupKey(offer: {
  companyName: string | null;
  title: string;
  location: Location;
}): string | null {
  const company = normalizeCompany(offer.companyName);
  const title = normalizeTitle(offer.title, offer.location);
  if (!company || !title) return null;
  const place = foldText(offer.location.city ?? offer.location.country ?? "");
  return `${company}|${title}|${place}`;
}

/** URL sans protocole, « www. », paramètres de suivi, ancre ni « / » final. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/(?:apply|application)\/?$/, "").replace(/\/+$/, "");
    return `${host}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}
