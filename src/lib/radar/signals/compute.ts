import type { CompanySignalType, RemotePolicy } from "@/generated/prisma/enums";
import { normalizeText } from "@/lib/matching/text";
import { SIGNAL_THRESHOLDS, type SignalThresholds } from "./config";
import { isLeadershipRole, jobFamily, type JobFamily } from "./families";

/**
 * Signaux faibles de recrutement d'une entreprise, calculés uniquement à
 * partir des offres déjà collectées (fonctions pures, sans base ni réseau).
 *
 * - `weekStats` reconstitue une semaine (nouvelles offres, fermetures, offres
 *   ouvertes, délai médian de fermeture, nouveautés…) depuis `firstSeenAt` /
 *   `closedAt` / `reopenedAt` ;
 * - `detectSignals` compare la semaine à l'historique propre de l'entreprise
 *   et renvoie les signaux franchissant les seuils de `./config.ts`.
 *
 * Les doublons inter-sources (`duplicateOfId`) sont écartés ; une entreprise
 * avec peu d'historique ne produit aucun signal plutôt que du bruit.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type HistoryOffer = {
  id: string;
  title: string;
  seniority: string | null;
  dedupKey: string | null;
  city: string | null;
  country: string | null;
  remotePolicy: RemotePolicy;
  hasSalary: boolean;
  firstSeenAt: Date;
  closedAt: Date | null;
  reopenedAt: Date | null;
  reopenCount: number;
  duplicateOfId: string | null;
};

/** Début de semaine (lundi 00:00 UTC) contenant `date`. */
export function weekStart(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
}

export function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * WEEK_MS);
}

/** Semaines terminées à recalculer, de la plus ancienne à la plus récente. */
export function completedWeeks(now: Date, count: number): Date[] {
  const current = weekStart(now);
  return Array.from({ length: count }, (_, i) => addWeeks(current, i - count));
}

export type RepostFact = { title: string; reopenCount: number };

export type WeekStats = {
  weekStart: Date;
  newOffers: number;
  closedOffers: number;
  /** Ouvertes à la fin de la semaine. */
  openCount: number;
  /** Ouvertes au début de la semaine. */
  openAtStart: number;
  medianDaysToClose: number | null;
  salaryShare: number | null;
  remoteShare: number | null;
  /** Nouvelles offres dont le télétravail est précisé / hybrides ou à distance. */
  remoteKnown: number;
  remoteFriendly: number;
  newCities: string[];
  newCountries: string[];
  newFamilies: JobFamily[];
  /** Nouvelles offres relevant d'une famille ou d'un lieu nouveau. */
  newFamilyOffers: number;
  newLocationOffers: number;
  firstLeadership: boolean;
  reposted: RepostFact[];
};

const inWeek = (date: Date | null, start: Date, end: Date) =>
  date !== null && date >= start && date < end;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

const placeKey = (value: string) => normalizeText(value);

/** Offres canoniques uniquement : un doublon d'une autre source n'est jamais compté. */
export function canonicalOffers<T extends { duplicateOfId: string | null }>(offers: T[]): T[] {
  return offers.filter((o) => o.duplicateOfId === null);
}

export function weekStats(
  allOffers: HistoryOffer[],
  start: Date,
  thresholds: SignalThresholds = SIGNAL_THRESHOLDS,
): WeekStats {
  const offers = canonicalOffers(allOffers);
  const end = addWeeks(start, 1);
  const prior = offers.filter((o) => o.firstSeenAt < start);
  const fresh = offers.filter((o) => inWeek(o.firstSeenAt, start, end));
  const closed = offers.filter((o) => inWeek(o.closedAt, start, end));
  const openAt = (t: Date) =>
    offers.filter((o) => o.firstSeenAt < t && (o.closedAt === null || o.closedAt >= t)).length;

  const remoteKnown = fresh.filter((o) => o.remotePolicy !== "UNKNOWN");
  const remoteFriendly = remoteKnown.filter(
    (o) => o.remotePolicy === "HYBRID" || o.remotePolicy === "FULL_REMOTE",
  );

  // Nouveautés : seulement face à un historique suffisant (sinon tout est « nouveau »).
  const enoughPrior = prior.length >= thresholds.novelty.minPriorOffers;
  const priorCities = new Set(prior.flatMap((o) => (o.city ? [placeKey(o.city)] : [])));
  const priorCountries = new Set(prior.flatMap((o) => (o.country ? [o.country] : [])));
  const priorFamilies = new Set(prior.map((o) => jobFamily(o.title)));
  const priorLeadership = prior.some((o) => isLeadershipRole(o.title, o.seniority));

  const newCities = new Map<string, string>();
  const newCountries = new Set<string>();
  const newFamilies = new Set<JobFamily>();
  let newFamilyOffers = 0;
  let newLocationOffers = 0;
  let leadership = false;
  if (enoughPrior) {
    for (const o of fresh) {
      let novelPlace = false;
      if (o.city && !priorCities.has(placeKey(o.city))) {
        if (!newCities.has(placeKey(o.city))) newCities.set(placeKey(o.city), o.city);
        novelPlace = true;
      }
      if (o.country && !priorCountries.has(o.country)) {
        newCountries.add(o.country);
        novelPlace = true;
      }
      if (novelPlace) newLocationOffers++;
      const family = jobFamily(o.title);
      if (family && !priorFamilies.has(family)) {
        newFamilies.add(family);
        newFamilyOffers++;
      }
      if (!priorLeadership && isLeadershipRole(o.title, o.seniority)) leadership = true;
    }
  }

  // Republications : même offre rouverte, ou nouvelle offre de même clé
  // qu'une offre fermée peu avant (le poste n'a pas été pourvu).
  const reposted: RepostFact[] = [];
  const closedByKey = new Map<string, Date[]>();
  for (const o of offers) {
    if (o.dedupKey && o.closedAt) {
      closedByKey.set(o.dedupKey, [...(closedByKey.get(o.dedupKey) ?? []), o.closedAt]);
    }
  }
  for (const o of offers) {
    if (inWeek(o.reopenedAt, start, end)) {
      reposted.push({ title: o.title, reopenCount: Math.max(1, o.reopenCount) });
      continue;
    }
    if (!o.dedupKey || !inWeek(o.firstSeenAt, start, end)) continue;
    const gaps = (closedByKey.get(o.dedupKey) ?? [])
      .map((closedAt) => (o.firstSeenAt.getTime() - closedAt.getTime()) / DAY_MS)
      .filter((gap) => gap >= 0 && gap <= thresholds.repost.maxGapDays);
    if (gaps.length > 0) reposted.push({ title: o.title, reopenCount: gaps.length });
  }

  return {
    weekStart: start,
    newOffers: fresh.length,
    closedOffers: closed.length,
    openCount: openAt(end),
    openAtStart: openAt(start),
    medianDaysToClose: median(
      closed.map((o) => (o.closedAt!.getTime() - o.firstSeenAt.getTime()) / DAY_MS),
    ),
    salaryShare: fresh.length ? fresh.filter((o) => o.hasSalary).length / fresh.length : null,
    remoteShare: remoteKnown.length ? remoteFriendly.length / remoteKnown.length : null,
    remoteKnown: remoteKnown.length,
    remoteFriendly: remoteFriendly.length,
    newCities: [...newCities.values()].sort(),
    newCountries: [...newCountries].sort(),
    newFamilies: [...newFamilies].sort(),
    newFamilyOffers,
    newLocationOffers,
    firstLeadership: leadership,
    reposted,
  };
}

// --- Signaux ---------------------------------------------------------------------------------

export type SignalFacts =
  | {
      type: "HIRING_SURGE";
      newOffers: number;
      baselineNew: number;
      openCount: number;
      baselineOpen: number;
    }
  | {
      type: "HIRING_FREEZE";
      quietWeeks: number;
      closedOffers: number;
      openBefore: number;
      openCount: number;
      medianDaysToClose: number | null;
    }
  | { type: "NEW_TEAM"; families: JobFamily[]; leadership: boolean; offers: number }
  | { type: "NEW_LOCATION"; cities: string[]; countries: string[]; offers: number }
  | { type: "REPOSTED_OFFER"; count: number; titles: string[]; maxReopenCount: number }
  | {
      type: "REMOTE_SHIFT";
      direction: "MORE_REMOTE" | "LESS_REMOTE";
      recentShare: number;
      baselineShare: number;
    };

export type DetectedSignal = {
  type: CompanySignalType;
  strength: 1 | 2 | 3;
  periodStart: Date;
  periodEnd: Date;
  facts: SignalFacts;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (share: number) => Math.round(share * 100);
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/** L'entreprise a-t-elle assez d'historique, à la fin de la semaine `start` ? */
export function hasEnoughHistory(
  allOffers: HistoryOffer[],
  start: Date,
  thresholds: SignalThresholds = SIGNAL_THRESHOLDS,
): boolean {
  const end = addWeeks(start, 1);
  const seen = canonicalOffers(allOffers).filter((o) => o.firstSeenAt < end);
  if (seen.length < thresholds.minOffers) return false;
  const first = weekStart(new Date(Math.min(...seen.map((o) => o.firstSeenAt.getTime()))));
  return addWeeks(first, thresholds.minHistoryWeeks) <= start;
}

/** Première semaine observée de l'entreprise (première collecte). */
function firstWeek(offers: HistoryOffer[]): Date {
  return weekStart(new Date(Math.min(...offers.map((o) => o.firstSeenAt.getTime()))));
}

/** Semaines de référence : avant `before`, sans la semaine de première collecte. */
function baselineStarts(
  offers: HistoryOffer[],
  before: Date,
  weeks: number,
  includeFirstWeek = false,
): Date[] {
  const first = firstWeek(offers);
  const from = includeFirstWeek ? first : addWeeks(first, 1);
  const starts: Date[] = [];
  for (let i = weeks; i >= 1; i--) {
    const s = addWeeks(before, -i);
    if (s >= from) starts.push(s);
  }
  return starts;
}

function remoteShareOver(stats: WeekStats[]) {
  const known = stats.reduce((n, s) => n + s.remoteKnown, 0);
  const friendly = stats.reduce((n, s) => n + s.remoteFriendly, 0);
  return { known, share: known ? friendly / known : 0 };
}

function remoteShift(
  offers: HistoryOffer[],
  start: Date,
  t: SignalThresholds,
  stat: (s: Date) => WeekStats,
): { delta: number; recent: number; baseline: number } | null {
  const recentStarts = Array.from({ length: t.remoteShift.recentWeeks }, (_, i) =>
    addWeeks(start, i - t.remoteShift.recentWeeks + 1),
  ).filter((s) => s >= firstWeek(offers));
  const recent = remoteShareOver(recentStarts.map(stat));
  const baseline = remoteShareOver(
    baselineStarts(offers, recentStarts[0] ?? start, t.baselineWeeks, true).map(stat),
  );
  if (recent.known < t.remoteShift.minSample || baseline.known < t.remoteShift.minSample) {
    return null;
  }
  const delta = recent.share - baseline.share;
  if (Math.abs(delta) < t.remoteShift.minDelta) return null;
  return { delta, recent: recent.share, baseline: baseline.share };
}

/**
 * Signaux de la semaine commençant à `start`. Aucun signal sans historique
 * suffisant (`minHistoryWeeks`, `minOffers`).
 */
export function detectSignals(
  allOffers: HistoryOffer[],
  start: Date,
  thresholds: SignalThresholds = SIGNAL_THRESHOLDS,
): DetectedSignal[] {
  const t = thresholds;
  const offers = canonicalOffers(allOffers);
  if (!hasEnoughHistory(offers, start, t)) return [];

  const cache = new Map<number, WeekStats>();
  const stat = (s: Date) => {
    let value = cache.get(s.getTime());
    if (!value) {
      value = weekStats(offers, s, t);
      cache.set(s.getTime(), value);
    }
    return value;
  };
  const week = stat(start);
  const periodEnd = addWeeks(start, 1);
  const signals: DetectedSignal[] = [];
  const push = (strength: 1 | 2 | 3, facts: SignalFacts) =>
    signals.push({ type: facts.type, strength, periodStart: start, periodEnd, facts });

  // Pic de recrutement : nouvelles offres ou offres ouvertes bien au-dessus de la normale.
  const baseline = baselineStarts(offers, start, t.baselineWeeks).map(stat);
  const baselineNew = mean(baseline.map((s) => s.newOffers));
  const baselineOpen = mean(baseline.map((s) => s.openCount));
  if (baseline.length > 0) {
    const newSurge =
      week.newOffers >= t.surge.minNew && week.newOffers >= t.surge.newRatio * baselineNew;
    const openSurge =
      week.openCount >= t.surge.openRatio * baselineOpen &&
      week.openCount - baselineOpen >= t.surge.minOpenIncrease;
    if (newSurge || openSurge) {
      const ratio = Math.max(
        newSurge ? week.newOffers / Math.max(baselineNew, 1) : 0,
        openSurge
          ? (week.openCount / Math.max(baselineOpen, 1)) * (t.surge.newRatio / t.surge.openRatio)
          : 0,
      );
      push(ratio >= t.surge.strongRatio ? 3 : ratio >= t.surge.mediumRatio ? 2 : 1, {
        type: "HIRING_SURGE",
        newOffers: week.newOffers,
        baselineNew: round1(baselineNew),
        openCount: week.openCount,
        baselineOpen: round1(baselineOpen),
      });
    }
  }

  // Gel : plus aucune nouvelle offre depuis `quietWeeks` semaines et fermetures massives.
  const quiet = Array.from({ length: t.freeze.quietWeeks }, (_, i) =>
    stat(addWeeks(start, i - t.freeze.quietWeeks + 1)),
  );
  const quietStart = quiet[0]!.weekStart;
  const before = baselineStarts(offers, quietStart, t.baselineWeeks).map(stat);
  const closedInQuiet = quiet.reduce((n, s) => n + s.closedOffers, 0);
  const openBefore = quiet[0]!.openAtStart;
  if (
    quietStart >= addWeeks(firstWeek(offers), 1) &&
    quiet.every((s) => s.newOffers === 0) &&
    closedInQuiet >= t.freeze.minClosed &&
    openBefore > 0 &&
    closedInQuiet / openBefore >= t.freeze.minClosedShare &&
    mean(before.map((s) => s.newOffers)) >= t.freeze.minBaselineNew
  ) {
    const share = closedInQuiet / openBefore;
    push(week.openCount === 0 || share >= 0.9 ? 3 : share >= 0.7 ? 2 : 1, {
      type: "HIRING_FREEZE",
      quietWeeks: t.freeze.quietWeeks,
      closedOffers: closedInQuiet,
      openBefore,
      openCount: week.openCount,
      medianDaysToClose: week.medianDaysToClose,
    });
  }

  // Nouvelle équipe : première offre d'une famille de métiers, ou premier poste d'encadrement.
  if (week.newFamilies.length > 0 || week.firstLeadership) {
    const notable = week.newFamilies.includes("DATA_AI") || week.firstLeadership;
    const strength = Math.min(3, 1 + (notable ? 1 : 0) + (week.newFamilyOffers >= 2 ? 1 : 0));
    push(strength as 1 | 2 | 3, {
      type: "NEW_TEAM",
      families: week.newFamilies,
      leadership: week.firstLeadership,
      offers: week.newFamilyOffers,
    });
  }

  // Nouveau lieu : première offre dans une ville ou un pays.
  if (week.newCities.length > 0 || week.newCountries.length > 0) {
    push(week.newCountries.length > 0 ? 3 : week.newLocationOffers >= 2 ? 2 : 1, {
      type: "NEW_LOCATION",
      cities: week.newCities,
      countries: week.newCountries,
      offers: week.newLocationOffers,
    });
  }

  // Offre republiée : poste difficile à pourvoir (levier de négociation).
  if (week.reposted.length > 0) {
    const maxReopen = Math.max(...week.reposted.map((r) => r.reopenCount));
    push(week.reposted.length >= 3 || maxReopen >= 2 ? 3 : week.reposted.length === 2 ? 2 : 1, {
      type: "REPOSTED_OFFER",
      count: week.reposted.length,
      titles: [...new Set(week.reposted.map((r) => r.title))].slice(0, 3),
      maxReopenCount: maxReopen,
    });
  }

  // Bascule de politique de télétravail : signalée la première semaine où l'écart apparaît.
  const shift = remoteShift(offers, start, t, stat);
  const previous = hasEnoughHistory(offers, addWeeks(start, -1), t)
    ? remoteShift(offers, addWeeks(start, -1), t, stat)
    : null;
  if (shift && !(previous && Math.sign(previous.delta) === Math.sign(shift.delta))) {
    const size = Math.abs(shift.delta);
    push(size >= 0.5 ? 3 : size >= 0.4 ? 2 : 1, {
      type: "REMOTE_SHIFT",
      direction: shift.delta > 0 ? "MORE_REMOTE" : "LESS_REMOTE",
      recentShare: pct(shift.recent),
      baselineShare: pct(shift.baseline),
    });
  }

  return signals;
}

// --- Pertinence ------------------------------------------------------------------------------

const TYPE_PRIORITY: Record<CompanySignalType, number> = {
  REPOSTED_OFFER: 0,
  HIRING_SURGE: 1,
  HIRING_FREEZE: 2,
  NEW_TEAM: 3,
  NEW_LOCATION: 4,
  REMOTE_SHIFT: 5,
};

/**
 * Signaux les plus utiles à afficher : le plus récent de chaque type, puis
 * du plus fort au plus faible, du plus récent au plus ancien.
 */
export function mostRelevant<
  T extends { type: CompanySignalType; strength: number; periodStart: Date },
>(signals: T[], limit: number): T[] {
  const latest = new Map<CompanySignalType, T>();
  for (const s of signals) {
    const current = latest.get(s.type);
    if (!current || s.periodStart > current.periodStart) latest.set(s.type, s);
  }
  return [...latest.values()]
    .sort(
      (a, b) =>
        b.strength - a.strength ||
        b.periodStart.getTime() - a.periodStart.getTime() ||
        TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type],
    )
    .slice(0, limit);
}
