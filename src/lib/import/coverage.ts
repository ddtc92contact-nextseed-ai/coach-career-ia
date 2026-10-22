import { COVERAGE_TOLERANCE_YEARS, type Coverage, type YearSpan } from "./shared";

/**
 * Contrôle de couverture de l'import : les années citées dans le CV sont
 * comparées à celles des expériences du brouillon. Un écart de plus de
 * `COVERAGE_TOLERANCE_YEARS` ans signale des périodes probablement oubliées
 * par le modèle (« le CV mentionne 2004-2024, la mémoire s'arrête en 2004 »).
 *
 * Règles simples, sans modèle : les lignes de formation et d'état civil sont
 * ignorées (leurs années ne sont pas des périodes d'activité) ; « depuis
 * 2005 », « 2019 – aujourd'hui »… prolongent le CV jusqu'à aujourd'hui.
 */

/** Années plausibles d'une carrière, hors montants (« 2000 € », « 2000 h »). */
const YEAR = /(?<![\d,.])(19[5-9]\d|20\d\d)(?![\d,.]|\s?(?:€|\$|£|%|k€|eur\b|h\b|heures\b))/giu;

const PRESENT_WORDS =
  "aujourd['’]hui|à ce jour|a ce jour|ce jour|présent|present|now|today|current|ongoing|en cours|heute|jetzt|derzeit|actualidad|actualmente|presente|hoy|oggi|attuale|in corso|heden|nu";
/** « 2019 – aujourd'hui », « 03/2019 - present »… */
const RANGE_TO_PRESENT = new RegExp(
  `\\d\\s*(?:[-–—]|à|to|bis|a|al|tot)\\s*(?:${PRESENT_WORDS})(?![\\p{L}])`,
  "iu",
);
/** « depuis 2005 », « since March 2019 », « seit 2010 »… */
const SINCE_YEAR =
  /(?<![\p{L}])(?:depuis|since|seit|desde|dal|dall['’]|sinds|vanaf)\s+(?:[\p{L}.]+\s+)?(?:19[5-9]\d|20\d\d)(?!\d)/iu;

/** Lignes dont les années ne décrivent pas une activité (formation, naissance, âge). */
const NOT_ACTIVITY_STEMS = [
  "formation",
  "diplôm",
  "diplom",
  "degree",
  "baccalaur",
  "universit",
  "école",
  "ecole",
  "school",
  "college",
  "lycée",
  "lycee",
  "studium",
  "ausbildung",
  "hochschule",
  "abitur",
  "formación",
  "titulo",
  "título",
  "istruzione",
  "laurea",
  "opleiding",
  "hogeschool",
  "naissance",
  "born",
  "geboren",
  "nacid",
];
const NOT_ACTIVITY_WORDS = [
  "bts",
  "dut",
  "bac",
  "né",
  "née",
  "nato",
  "nata",
  "âge",
  "age",
  "alter",
];
const NOT_ACTIVITY = new RegExp(
  `(?<![\\p{L}])(?:${NOT_ACTIVITY_STEMS.join("|")}|(?:${NOT_ACTIVITY_WORDS.join("|")})(?![\\p{L}]))`,
  "iu",
);

/** Période d'activité citée par le CV, ou `null` s'il ne cite aucune année. */
export function cvYearSpan(text: string, nowYear: number): YearSpan | null {
  const years: number[] = [];
  let present = false;
  for (const line of text.split("\n")) {
    if (NOT_ACTIVITY.test(line)) continue;
    for (const match of line.matchAll(YEAR)) {
      const year = Number(match[1]);
      if (year <= nowYear) years.push(year);
    }
    if (RANGE_TO_PRESENT.test(line) || SINCE_YEAR.test(line)) present = true;
  }
  if (!years.length) return null;
  const to = Math.max(...years);
  return { from: Math.min(...years), to: present || to >= nowYear ? null : to };
}

type DatedExperience = { startMonth: string; endMonth?: string };

/** Période couverte par les expériences ; une expérience sans fin court jusqu'à aujourd'hui. */
export function memoryYearSpan(experiences: DatedExperience[], now: string): YearSpan | null {
  const nowYear = Number(now.slice(0, 4));
  const starts: number[] = [];
  const ends: number[] = [];
  let ongoing = false;
  for (const { startMonth, endMonth } of experiences) {
    const start = startMonth && startMonth <= now ? Number(startMonth.slice(0, 4)) : null;
    const end = endMonth && endMonth <= now ? Number(endMonth.slice(0, 4)) : null;
    if (start !== null) starts.push(start);
    if (end !== null) ends.push(end);
    else if (start !== null) ongoing = true;
  }
  const all = [...starts, ...ends];
  if (!all.length) return null;
  const to = Math.max(...all);
  return { from: Math.min(...all), to: ongoing || to >= nowYear ? null : to };
}

export function checkCoverage(
  cvText: string,
  experiences: DatedExperience[],
  now: string,
): Coverage | null {
  const nowYear = Number(now.slice(0, 4));
  const cv = cvYearSpan(cvText, nowYear);
  if (!cv) return null;
  const memory = memoryYearSpan(experiences, now);
  if (!memory) return { cv, memory, missingYears: { before: 0, after: 0 }, gap: "empty" };
  const missingYears = {
    before: Math.max(0, memory.from - cv.from),
    after: Math.max(0, (cv.to ?? nowYear) - (memory.to ?? nowYear)),
  };
  const before = missingYears.before > COVERAGE_TOLERANCE_YEARS;
  const after = missingYears.after > COVERAGE_TOLERANCE_YEARS;
  return {
    cv,
    memory,
    missingYears,
    gap: before && after ? "both" : before ? "before" : after ? "after" : null,
  };
}
