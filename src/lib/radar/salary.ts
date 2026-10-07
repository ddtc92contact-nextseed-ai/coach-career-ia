import type { Salary, SalaryPeriod } from "./types";

/**
 * Lecture des rémunérations ANNONCÉES. Rien n'est jamais estimé : sans
 * montant ni devise explicites, le résultat est `null`.
 *
 * Exemples gérés : « 45-55 k€ », « 50 000 € annuel », « 2 500 € / mois »,
 * « 450 €/jour », « 11,88 € de l'heure », « €46K – €53K »,
 * « Annuel de 45000.00 Euros à 55000.00 Euros sur 12 mois » (France Travail),
 * « jusqu'à 60 k€ », « à partir de 40 000 € ».
 */

const CURRENCIES: [RegExp, string][] = [
  [/€|\beur\b|\beuros?\b/, "EUR"],
  [/£|\bgbp\b/, "GBP"],
  [/\bchf\b/, "CHF"],
  [/\$|\busd\b/, "USD"],
];

const PERIODS: [RegExp, SalaryPeriod][] = [
  [/\b(?:horaires?|heures?|hour(?:ly)?)\b|\/\s*h\b|€\s*h\b/, "HOUR"],
  [/\b(?:jours?|journaliers?|day|daily|tjm)\b|\/\s*j\b/, "DAY"],
  [/\b(?:mensuel(?:le)?s?|mois|month(?:ly)?)\b|\/\s*m\b/, "MONTH"],
  [
    /\b(?:annuel(?:le)?s?|an|ans|ann[ée]e|year(?:ly)?|annual(?:ly)?|p\.?a)\b|\/\s*an\b|\bk€/,
    "YEAR",
  ],
];

// Montant : « 45 000 », « 45.000 », « 45000.00 », « 11,88 », « 45k ».
const AMOUNT = /(\d{1,3}(?:[ .'’]\d{3})+(?!\d)|\d+)(?:[.,](\d{1,2}))?(?!\d)(\s*k(?![a-z]))?/g;
const RANGE_GAP =
  /^\s*(?:k\s*)?(?:€|eur|euros?|\$|£)?\s*(?:brut|bruts)?\s*(?:-|–|—|à|a|au|to|et|and)\s*(?:€|eur|\$|£)?\s*$/;
const MAX_ONLY = /(?:jusqu'?\s*[àa]|up to|max(?:imum)?\.?)\s*(?:€|\$|£)?\s*$/;
const MIN_ONLY = /(?:[àa] partir de|d[èe]s|from|min(?:imum)?\.?|starting at)\s*(?:€|\$|£)?\s*$/;
const VARIABLE = /\b(?:variables?|primes?|bonus|commissions?|int[ée]ressement|participation)\b/;
const EQUITY = /\b(?:bspce|equity|stock[- ]options?|actions gratuites|rsu)\b/;

type Amount = { value: number; k: boolean; start: number; end: number };

function readAmounts(text: string): Amount[] {
  const amounts: Amount[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const integer = m[1]!.replace(/[ .'’]/g, "");
    const value = Number(`${integer}${m[2] ? `.${m[2]}` : ""}`);
    if (!Number.isFinite(value)) continue;
    const k = Boolean(m[3]);
    amounts.push({ value, k, start: m.index, end: m.index + m[0].length });
  }
  return amounts;
}

function nearCurrency(text: string, a: Amount, b: Amount | undefined): boolean {
  const after = text.slice((b ?? a).end, (b ?? a).end + 12);
  const before = text.slice(Math.max(0, a.start - 3), a.start);
  return /^\s*(?:k\s*)?(?:€|eur|euros?|\$|£|chf|gbp|usd)/.test(after) || /[€$£]\s*$/.test(before);
}

function detectPeriod(text: string): SalaryPeriod | null {
  // « sur 12 mois » / « 13e mois » décrivent le versement, pas la période.
  const cleaned = text
    .replace(/sur\s+\d+(?:[.,]\d+)?\s*mois/g, " ")
    .replace(/\d+\s*(?:e|è|ème)\s*mois/g, " ");
  let best: { index: number; period: SalaryPeriod } | null = null;
  for (const [re, period] of PERIODS) {
    const m = re.exec(cleaned);
    if (m && (!best || m.index < best.index)) best = { index: m.index, period };
  }
  return best?.period ?? null;
}

function phrase(text: string, re: RegExp): string | null {
  const parts = text.split(/[.;\n]|\s\+\s|,\s/);
  const hit = parts.find((p) => re.test(p.toLowerCase()));
  const cleaned = hit?.replace(/^\s*\+?\s*/, "").trim();
  return cleaned ? cleaned.slice(0, 200) : null;
}

function normalise(input: string): string {
  return input.replace(/[   ]/g, " ").toLowerCase();
}

/** Lit un texte de rémunération libre. `null` si aucun élément n'est annoncé. */
export function parseSalaryText(input: string | null | undefined): Salary | null {
  if (!input || !input.trim()) return null;
  const raw = input.replace(/\s+/g, " ").trim();
  const text = normalise(raw);

  const variable = VARIABLE.test(text) ? phrase(raw, VARIABLE) : null;
  const equity = EQUITY.test(text) ? phrase(raw, EQUITY) : null;
  const currency = CURRENCIES.find(([re]) => re.test(text))?.[1] ?? null;

  let min: number | null = null;
  let max: number | null = null;

  if (currency) {
    const amounts = readAmounts(text);
    for (let i = 0; i < amounts.length; i++) {
      const a = amounts[i]!;
      const next = amounts[i + 1];
      const isRange = next !== undefined && RANGE_GAP.test(text.slice(a.end, next.start));
      const b = isRange ? next : undefined;
      if (!nearCurrency(text, a, b)) continue;

      // « 45-55 k€ » : le « k » final s'applique aux deux bornes.
      const kAll = a.k || (b?.k ?? false);
      const scale = (x: Amount) => (x.k || (kAll && x.value < 1000) ? x.value * 1000 : x.value);
      const low = scale(a);
      const high = b ? scale(b) : low;
      const before = text.slice(Math.max(0, a.start - 20), a.start);
      if (MAX_ONLY.test(before)) max = high;
      else if (MIN_ONLY.test(before) && !b) min = low;
      else {
        min = low;
        max = high;
      }
      break;
    }
  }

  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  if ((min !== null && min <= 0) || (max !== null && max <= 0)) min = max = null;

  const hasAmount = min !== null || max !== null;
  if (!hasAmount && !variable && !equity) return null;

  let period: SalaryPeriod | null = null;
  if (hasAmount) {
    period = detectPeriod(text);
    // Sans période explicite, seul un montant annuel est sans ambiguïté.
    if (!period && Math.max(min ?? 0, max ?? 0) >= 10_000) period = "YEAR";
  }

  return {
    min,
    max,
    currency: hasAmount ? currency : null,
    period,
    variable,
    equity,
    raw: raw.slice(0, 500),
  };
}

/** Fusionne une rémunération principale et des compléments (primes…). */
export function withComplements(
  salary: Salary | null,
  complements: (string | null)[],
): Salary | null {
  const extras = complements.filter((c): c is string => Boolean(c && c.trim()));
  const variable = extras.filter((c) => VARIABLE.test(normalise(c))).join(", ") || null;
  const equity = extras.filter((c) => EQUITY.test(normalise(c))).join(", ") || null;
  if (!salary && !variable && !equity) return salary;
  const base: Salary = salary ?? {
    min: null,
    max: null,
    currency: null,
    period: null,
    variable: null,
    equity: null,
    raw: null,
  };
  return {
    ...base,
    variable: [base.variable, variable].filter(Boolean).join(", ") || null,
    equity: [base.equity, equity].filter(Boolean).join(", ") || null,
  };
}

const INTERVALS: Record<string, SalaryPeriod> = {
  "1 HOUR": "HOUR",
  "1 DAY": "DAY",
  "1 MONTH": "MONTH",
  "1 YEAR": "YEAR",
  "per-hour-wage": "HOUR",
  "per-day-wage": "DAY",
  "per-month-salary": "MONTH",
  "per-year-salary": "YEAR",
};

/** Période d'une rémunération structurée (Ashby, Lever). */
export function periodFromInterval(interval: unknown): SalaryPeriod | null {
  return typeof interval === "string" ? (INTERVALS[interval] ?? null) : null;
}

export function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
