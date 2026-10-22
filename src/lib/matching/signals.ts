import {
  SECTORS,
  type CulturePreferenceCode,
  type SectorCode,
  type SeniorityCode,
} from "@/lib/career/codes";
import { normalizeText, sentences, termPattern } from "./text";

/**
 * Informations lues dans le texte d'une offre (fonctions pures, sans IA) :
 * horaires, jours de télétravail, astreintes, secteur, culture, séniorité.
 * Règle : on ne lit que ce qui est ÉCRIT. Sans mention claire, le résultat
 * est `null` (inconnu) et le filtre correspondant ne s'applique pas.
 */

// --- Horaires hebdomadaires ---------------------------------------------------------

const HOURS_PATTERNS = [
  // « 39h/semaine », « 35 heures hebdomadaires », « 40 hours per week », « 37,5h par semaine »
  /(\d{2}(?:[.,]\d{1,2})?)\s*(?:h|heures?|hours?|hrs?)\s*(?:\/|par|per|a la|a|de travail)?\s*(?:semaine|sem\b|week|hebdo(?:madaires?)?)/g,
  // « 35H Horaires normaux » (France Travail)
  /(\d{2}(?:[.,]\d{1,2})?)\s*h\s*horaires?/g,
  // « durée hebdomadaire : 39 h », « weekly hours: 40 »
  /(?:duree hebdomadaire|temps de travail hebdomadaire|weekly hours)\s*(?:de|:)?\s*(\d{2}(?:[.,]\d{1,2})?)/g,
];

/** Durée hebdomadaire annoncée (la plus élevée citée), ou `null`. */
export function statedWeeklyHours(text: string): number | null {
  const normalized = normalizeText(text);
  let max: number | null = null;
  for (const pattern of HOURS_PATTERNS) {
    for (const m of normalized.matchAll(pattern)) {
      const hours = Number(m[1]!.replace(",", "."));
      if (hours >= 10 && hours <= 80 && (max === null || hours > max)) max = hours;
    }
  }
  return max;
}

// --- Jours de télétravail ---------------------------------------------------------------

const REMOTE_WORD =
  "(?:teletravail|tele-travail|remote|home ?office|full remote|travail a distance)";
const DAYS_WORD = "(?:j|jours?|days?)";
const REMOTE_DAYS_PATTERNS = [
  // « 2 jours de télétravail », « 3j de remote », « 2 days remote »
  new RegExp(
    `\\b([1-5])\\s*${DAYS_WORD}\\b\\s*(?:\\/\\s*semaine\\s*)?(?:de |of |en )?${REMOTE_WORD}`,
    "g",
  ),
  // « télétravail 2j/semaine », « télétravail : jusqu'à 3 jours », « remote up to 2 days »
  new RegExp(
    `${REMOTE_WORD}\\s*(?:partiel\\s*)?(?::|possible|de|jusqu'a|up to|\\()?\\s*(?:jusqu'a|up to)?\\s*([1-5])\\s*${DAYS_WORD}\\b`,
    "g",
  ),
];

/** Nombre de jours de télétravail par semaine annoncé, ou `null`. */
export function statedRemoteDays(text: string): number | null {
  const normalized = normalizeText(text);
  let max: number | null = null;
  for (const pattern of REMOTE_DAYS_PATTERNS) {
    for (const m of normalized.matchAll(pattern)) {
      const days = Number(m[1]);
      if (max === null || days > max) max = days;
    }
  }
  return max;
}

// --- Astreintes -------------------------------------------------------------------------------

const ON_CALL = /\b(?:astreintes?|on[- ]call|permanences? (?:de nuit|le week-end|week-end))\b/g;
const NEGATION =
  /(?:\bpas d'|\bpas de |\bsans |\baucune |\bno |\bwithout |\bnot |\bhors )[\w' -]{0,12}$/;

/** Vrai si l'offre mentionne des astreintes (hors « sans astreinte »), sinon `false`. */
export function mentionsOnCall(text: string): boolean {
  const normalized = normalizeText(text);
  for (const m of normalized.matchAll(ON_CALL)) {
    const before = normalized.slice(Math.max(0, m.index - 20), m.index);
    if (!NEGATION.test(before)) return true;
  }
  return false;
}

// --- Déplacements -----------------------------------------------------------------------------

const TRAVEL_PLACE =
  "(?:(?:le |au |aux |du |des |les |nos |notre |vos |our |the |your )?(?:siege(?: social)?|bureaux?|locaux|agences?|sites? clients?|clients?|client sites?|headquarters|hq|offices?|customers?|customer sites?))";
const FREQUENCY =
  "(?:une|deux|trois|quatre|[1-9])\\s*(?:fois|x)\\s*par\\s*(?:semaine|mois|trimestre)|(?:once|twice|(?:three|four|[1-9])\\s*times)\\s*(?:a|per|every)\\s*(?:week|month|quarter)";
const TRAVEL_PATTERNS = [
  // « déplacements fréquents / réguliers / à prévoir », « déplacements chez les clients »
  /\bdeplacements?\s*(?:frequents?|reguliers?|ponctuels?|occasionnels?|nationaux|internationaux|(?:sont |seront )?a prevoir|(?:sont |seront )?necessaires|(?:sont |seront )?requis|en france|en europe|chez|au siege|aux? (?:bureaux?|locaux)|sur site|(?:jusqu'a |d'environ |de )?\d{1,3}\s*%)/g,
  /\b(?:se deplacer|vous deplacer|vous rendre|vous etes amene a vous deplacer)\b[^.;\n]{0,40}?(?:regulierement|frequemment|chez|au siege|aux? (?:bureaux?|locaux)|sur site)/g,
  // « présence au bureau de Lyon une fois par mois », « présence sur site »
  /\bpresence\s*(?:physique\s*)?(?:au|aux|dans (?:nos|les)|sur|a notre)\s*(?:bureaux?|siege|locaux|site|agence)/g,
  /\bvisites?\s*(?:chez |de |aux? )?(?:nos |les |des )?clients?\b/g,
  // « visit our clients », « travel to our headquarters », « trips to the office »
  new RegExp(
    `\\b(?:visit(?:s|ing)?|travel(?:s|l?ing)?\\s*to|trips?\\s*to|commute\\s*to)\\s*${TRAVEL_PLACE}\\b`,
    "g",
  ),
  // « up to 30 % travel », « 20% travel », « travel up to 25 % »
  /\b(?:up to\s*)?\d{1,3}\s*%\s*(?:of\s*)?(?:the time\s*)?(?:travel|travelling|traveling)\b/g,
  /\btravel(?:l?ing)?\s*(?:of\s*)?(?:up to\s*)?\d{1,3}\s*%/g,
  /\bon[- ]?site\s*(?:visits?|presence|meetings?|days?)\b/g,
  /\b(?:frequent|regular|occasional|domestic|international|extensive|some)\s*travel(?:l?ing)?\b/g,
  /\b(?:travel|travelling|traveling)\s*(?:is\s*)?(?:required|expected|needed|necessary)\b/g,
  /\b(?:willing(?:ness)?|able|ability|available)\s*to\s*travel\b/g,
];
/** Fréquence (« 2 fois par mois », « twice a month ») avec un lieu dans la même phrase. */
const FREQUENCY_PATTERN = new RegExp(`\\b(?:${FREQUENCY})\\b`, "g");
const FREQUENCY_CONTEXT = new RegExp(
  `\\b(?:siege|bureaux?|locaux|agences?|clients?|sur site|headquarters|hq|offices?|customers?|on-?site|visit|travel|deplacements?|presence)\\b`,
);
const TRAVEL_NEGATION =
  /(?:\bpas d'|\bpas de |\bsans |\baucune? |\bnon |\bno |\bwithout |\bnot |\bnever |\bzero |\bni )[\w' -]{0,16}$/;

function negated(normalized: string, index: number): boolean {
  return TRAVEL_NEGATION.test(normalized.slice(Math.max(0, index - 24), index));
}

/**
 * Vrai si l'offre mentionne des déplacements réguliers ou un rattachement
 * géographique (« déplacements à prévoir », « 2 fois par mois au siège »,
 * « visit our clients », « up to 30 % travel »), hors mentions négatives
 * (« pas de déplacement », « no travel required »). Signal seulement : sert à
 * avertir sur une offre en télétravail complet, jamais à l'exclure.
 */
export function mentionsTravel(text: string): boolean {
  const normalized = normalizeText(text);
  for (const pattern of TRAVEL_PATTERNS) {
    for (const m of normalized.matchAll(pattern)) {
      if (!negated(normalized, m.index)) return true;
    }
  }
  for (const sentence of sentences(normalized)) {
    for (const m of sentence.matchAll(FREQUENCY_PATTERN)) {
      if (!negated(sentence, m.index) && FREQUENCY_CONTEXT.test(sentence)) return true;
    }
  }
  return false;
}

const PLACE_NOUN =
  "(?:[Hh]eadquarters|HQ|[Oo]ffices?|[Ss]i[eè]ge(?: social)?|[Bb]ureaux?|[Ll]ocaux|[Aa]gence|[Ss]ite)";
const PLACE_LINK =
  "(?:near|close to|in|at|based in|located in|près de|pres de|à proximité de|a proximite de|à|a|de|d'|en)";
const CITY = "(\\p{Lu}[\\p{L}'’-]+(?:[ -](?:sur|sous|en|le|la|les|de|du)[ -]\\p{Lu}[\\p{L}'’-]+)?)";
const PLACE_PATTERN = new RegExp(
  `(?<![\\p{L}])${PLACE_NOUN}(?![\\p{L}])(?:\\s+(?:social|principal|parisien|européen|europeen|français|francais))?\\s*(?:\\(\\s*${CITY}\\s*\\)|,?\\s*${PLACE_LINK}\\s*${CITY})`,
  "u",
);
const NOT_A_CITY = new Set(["Our", "The", "Your", "Nos", "Notre", "Vos", "Votre", "France"]);

/**
 * Ville du siège ou du bureau cité avec les déplacements (« our headquarters
 * near Lille », « présence au bureau de Lyon »), seulement si c'est écrit
 * simplement ; sinon `null`.
 */
export function travelDestination(text: string): string | null {
  for (const sentence of sentences(text)) {
    if (!mentionsTravel(sentence)) continue;
    const m = PLACE_PATTERN.exec(sentence);
    const city = m?.[1] ?? m?.[2];
    if (city && !NOT_A_CITY.has(city)) return city.replace(/’/g, "'").slice(0, 60);
  }
  return null;
}

// --- Secteurs -------------------------------------------------------------------------------

/**
 * Mots-clés (normalisés) des secteurs, appliqués au SEUL secteur déclaré de
 * l'offre (secteur d'activité France Travail, secteur de l'entreprise suivie).
 * Ni la description (« clients du secteur bancaire » ne fait pas d'un éditeur
 * une banque) ni l'intitulé (« Chargé de recrutement » existe dans tous les
 * secteurs).
 */
const SECTOR_KEYWORDS: Partial<Record<SectorCode, string[]>> = {
  AEROSPACE_DEFENSE: ["aeronautique", "aerospatial", "aerospace", "defense", "armement", "spatial"],
  AGRIFOOD: ["agroalimentaire", "agro-alimentaire", "agriculture", "food", "alimentaire"],
  AUTOMOTIVE_MOBILITY: ["automobile", "automotive", "mobilite", "mobility", "constructeur auto"],
  BANKING_INSURANCE: [
    "banque",
    "bancaire",
    "bank",
    "banking",
    "assurance",
    "insurance",
    "assureur",
    "mutuelle",
  ],
  BIOTECH_PHARMA: [
    "pharmaceutique",
    "pharma",
    "biotech",
    "biotechnologie",
    "laboratoire pharmaceutique",
  ],
  CONSTRUCTION_REAL_ESTATE: [
    "btp",
    "construction",
    "immobilier",
    "real estate",
    "promotion immobiliere",
  ],
  CONSULTING: ["conseil", "consulting", "cabinet de conseil", "esn", "ssii"],
  CYBERSECURITY: ["cybersecurite", "cybersecurity", "securite informatique"],
  ECOMMERCE_RETAIL: [
    "e-commerce",
    "ecommerce",
    "commerce de detail",
    "retail",
    "grande distribution",
  ],
  EDUCATION_EDTECH: ["enseignement", "education", "edtech", "formation professionnelle"],
  ENERGY_UTILITIES: ["energie", "energy", "electricite", "utilities", "nucleaire"],
  ENVIRONMENT_CLEANTECH: [
    "environnement",
    "cleantech",
    "climat",
    "climate",
    "recyclage",
    "dechets",
  ],
  FINTECH: ["fintech", "paiement", "payments"],
  GAMBLING: [
    "jeux d'argent",
    "jeux de hasard",
    "paris sportifs",
    "pari sportif",
    "casino",
    "casinos",
    "gambling",
    "betting",
    "poker",
    "loterie",
    "lottery",
  ],
  GAMING: ["jeu video", "jeux video", "video game", "gaming"],
  HEALTHCARE_HEALTHTECH: ["sante", "healthcare", "healthtech", "hopital", "medical", "clinique"],
  HOSPITALITY_TOURISM: ["hotellerie", "hospitality", "tourisme", "tourism", "restauration"],
  HR_RECRUITMENT: [
    "recrutement",
    "ressources humaines",
    "recruitment",
    "staffing",
    "travail temporaire",
  ],
  INDUSTRY_MANUFACTURING: ["industrie", "industriel", "manufacturing", "usine", "fabrication"],
  LEGAL: ["juridique", "legal", "avocats", "cabinet d'avocats", "notariat"],
  LUXURY_FASHION: ["luxe", "luxury", "fashion", "pret-a-porter", "maroquinerie", "joaillerie"],
  MARKETING_ADVERTISING: [
    "publicite",
    "advertising",
    "marketing",
    "agence de communication",
    "adtech",
  ],
  MEDIA_ENTERTAINMENT: [
    "media",
    "medias",
    "presse",
    "maison d'edition",
    "audiovisuel",
    "entertainment",
    "divertissement",
  ],
  NONPROFIT: ["association", "ong", "ngo", "non-profit", "nonprofit", "fondation"],
  OIL_GAS: [
    "petrole",
    "petrolier",
    "petroliere",
    "oil",
    "gas",
    "gaz",
    "hydrocarbures",
    "raffinerie",
  ],
  PUBLIC_ADMINISTRATION: [
    "administration publique",
    "fonction publique",
    "collectivite",
    "public sector",
    "ministere",
  ],
  SAAS_SOFTWARE: [
    "logiciel",
    "software",
    "saas",
    "edition de logiciels",
    "programmation informatique",
  ],
  TELECOM: ["telecom", "telecommunications", "operateur telecom"],
  TOBACCO_ALCOHOL: [
    "tabac",
    "tobacco",
    "cigarettes",
    "alcool",
    "alcohol",
    "spiritueux",
    "spirits",
    "brasserie",
    "vins et spiritueux",
  ],
  TRANSPORT_LOGISTICS: ["transport", "logistique", "logistics", "fret", "supply chain"],
};

const SECTOR_PATTERNS = Object.entries(SECTOR_KEYWORDS).map(
  ([code, words]) => [code as SectorCode, words.map((w) => termPattern(w))] as const,
);

/** Secteurs reconnus dans le secteur déclaré de l'offre. */
export function detectSectors(sector: string | null | undefined): SectorCode[] {
  // Offres publiées directement : le secteur est déjà un code.
  if (sector && (SECTORS as readonly string[]).includes(sector)) return [sector as SectorCode];
  const normalized = normalizeText(sector ?? "");
  if (!normalized) return [];
  return SECTOR_PATTERNS.filter(([, patterns]) => patterns.some((p) => p.test(normalized))).map(
    ([code]) => code,
  );
}

// --- Culture d'entreprise --------------------------------------------------------------------------

const CULTURE_KEYWORDS: Record<CulturePreferenceCode, string[]> = {
  ASYNC_FIRST: ["asynchrone", "async", "asynchronous", "async-first", "remote-first"],
  FLAT_HIERARCHY: [
    "hierarchie horizontale",
    "hierarchie plate",
    "flat hierarchy",
    "flat organization",
    "organisation horizontale",
    "holacratie",
  ],
  STRUCTURED_PROCESSES: [
    "processus structures",
    "process structures",
    "cadre structure",
    "structured processes",
    "iso 9001",
  ],
  FAST_PACED: [
    "fast-paced",
    "fast paced",
    "rythme soutenu",
    "hypercroissance",
    "hyper-croissance",
    "forte croissance",
  ],
  WORK_LIFE_BALANCE: [
    "equilibre vie pro",
    "equilibre vie professionnelle",
    "work-life balance",
    "work life balance",
    "semaine de 4 jours",
    "4-day week",
    "horaires flexibles",
    "flexible hours",
  ],
  LEARNING_CULTURE: [
    "formation continue",
    "budget formation",
    "learning budget",
    "mentorat",
    "mentoring",
    "conferences",
    "plan de formation",
  ],
  // Pas « mission » seul : « vos missions » figure dans presque toutes les offres.
  MISSION_DRIVEN: [
    "entreprise a mission",
    "societe a mission",
    "b corp",
    "bcorp",
    "tech for good",
    "impact social",
    "impact positif",
    "esus",
  ],
  DIVERSITY_INCLUSION: [
    "diversite",
    "inclusion",
    "diversity",
    "handicap",
    "egalite des chances",
    "equal opportunity",
  ],
  INTERNATIONAL: [
    "international",
    "internationale",
    "anglais courant",
    "fluent english",
    "multiculturel",
    "multicultural",
  ],
  SMALL_TEAMS: [
    "petites equipes",
    "small teams",
    "equipe a taille humaine",
    "squad",
    "squads",
    "feature team",
  ],
  ENGINEERING_CULTURE: [
    "culture tech",
    "culture technique",
    "engineering culture",
    "code review",
    "revue de code",
    "tests automatises",
    "craft",
    "software craftsmanship",
  ],
  TRANSPARENT_PAY: [
    "grille salariale",
    "grilles de salaire",
    "salary grid",
    "transparent pay",
    "transparence salariale",
    "pay transparency",
  ],
};

const CULTURE_PATTERNS = (
  Object.entries(CULTURE_KEYWORDS) as [CulturePreferenceCode, string[]][]
).map(([code, words]) => [code, words.map((w) => termPattern(w))] as const);

/** Éléments de culture d'entreprise mentionnés par l'offre. */
export function detectCulture(text: string): CulturePreferenceCode[] {
  const normalized = normalizeText(text);
  return CULTURE_PATTERNS.filter(([, patterns]) => patterns.some((p) => p.test(normalized))).map(
    ([code]) => code,
  );
}

// --- Séniorité -------------------------------------------------------------------------------------

/** Échelle commune : rang de chaque niveau de séniorité. */
export const SENIORITY_RANK: Record<SeniorityCode, number> = {
  INTERN: 0,
  JUNIOR: 1,
  MID: 2,
  SENIOR: 3,
  LEAD: 4,
  MANAGER: 4,
  DIRECTOR: 5,
  EXECUTIVE: 6,
};

const TITLE_LEVELS: [RegExp, number][] = [
  [/\b(?:ceo|cto|cfo|coo|cpo|chief|vp|vice[- ]president|directeur general|managing director)\b/, 6],
  [/\b(?:directeur|directrice|director|head of)\b/, 5],
  [/\b(?:lead|principal|staff|tech lead|team lead|manager|responsable|chef de projet senior)\b/, 4],
  [/\b(?:senior|sr\.?|confirme|confirmee|experimente|experimentee|expert|experte)\b/, 3],
  [/\b(?:junior|jr\.?|debutant|debutante|entry[- ]level|graduate)\b/, 1],
  [
    /\b(?:stage|stagiaire|intern|internship|alternance|alternant|alternante|apprenti|apprentie|apprentissage|v\.?i\.?e)\b/,
    0,
  ],
];

function levelFromYears(years: number): number {
  if (years < 2) return 1;
  if (years < 5) return 2;
  if (years < 8) return 3;
  return 4;
}

/**
 * Rang de séniorité attendu par l'offre (échelle `SENIORITY_RANK`), d'après
 * l'intitulé puis l'expérience demandée (« 5 An(s) », « 3+ years »). `null`
 * si l'offre ne dit rien d'exploitable.
 */
export function offerSeniorityRank(title: string, seniority: string | null): number | null {
  // Offres publiées directement : séniorité saisie comme code.
  if (seniority && seniority in SENIORITY_RANK) return SENIORITY_RANK[seniority as SeniorityCode];
  const normalizedTitle = normalizeText(title);
  for (const [pattern, rank] of TITLE_LEVELS) {
    if (pattern.test(normalizedTitle)) return rank;
  }
  const label = normalizeText(seniority ?? "");
  if (!label) return null;
  if (/debutant accepte|debutant|entry/.test(label)) return 1;
  const years = /(\d{1,2})\s*\+?\s*(?:an|ans|an\(s\)|annees?|years?|yrs?)\b/.exec(label);
  if (years) return levelFromYears(Number(years[1]));
  const months = /(\d{1,2})\s*mois/.exec(label);
  if (months) return 1;
  for (const [pattern, rank] of TITLE_LEVELS) {
    if (pattern.test(label)) return rank;
  }
  return null;
}

// --- Noms d'entreprises ---------------------------------------------------------------------------

const LEGAL_TOKENS = new Set([
  "sa",
  "sas",
  "sasu",
  "sarl",
  "eurl",
  "sca",
  "snc",
  "scop",
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "llc",
  "llp",
  "plc",
  "gmbh",
  "ag",
  "bv",
  "nv",
  "spa",
  "srl",
  "se",
  "corp",
  "corporation",
  "co",
  "company",
  "group",
  "groupe",
  "holding",
  "france",
  "the",
]);

/** Nom d'entreprise comparable : sans accents, ponctuation ni forme juridique. */
export function companyTokens(name: string): string[] {
  return normalizeText(name)
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token && !LEGAL_TOKENS.has(token));
}

/**
 * Vrai si `companyName` désigne l'entreprise exclue : les mots du nom exclu
 * apparaissent, consécutifs, dans le nom de l'entreprise de l'offre
 * (« Globex » exclut « Globex Corporation France »).
 */
export function isSameCompany(companyName: string, excludedName: string): boolean {
  const offer = companyTokens(companyName);
  const excluded = companyTokens(excludedName);
  if (offer.length === 0 || excluded.length === 0) return false;
  for (let i = 0; i + excluded.length <= offer.length; i++) {
    if (excluded.every((token, j) => offer[i + j] === token)) return true;
  }
  return false;
}
