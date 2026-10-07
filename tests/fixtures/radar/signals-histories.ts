import type { HistoryOffer } from "@/lib/radar/signals/compute";

/**
 * Historiques d'offres enregistrés pour les tests des signaux faibles.
 * Les dates sont exprimées en semaines depuis `ORIGIN` (lundi 1er juin 2026,
 * semaine de la première collecte), plus un décalage en jours.
 */
export const ORIGIN = new Date("2026-06-01T00:00:00.000Z");

export const at = (week: number, day = 1) =>
  new Date(ORIGIN.getTime() + (week * 7 + day) * 86_400_000);

export type Spec = {
  title?: string;
  week: number;
  day?: number;
  closedWeek?: number;
  reopenedWeek?: number;
  reopenCount?: number;
  city?: string;
  country?: string;
  remote?: HistoryOffer["remotePolicy"];
  salary?: boolean;
  dedupKey?: string;
  duplicateOf?: string;
  seniority?: string;
};

let sequence = 0;

export function offer(spec: Spec): HistoryOffer {
  const id = `o${++sequence}`;
  return {
    id,
    title: spec.title ?? "Développeur backend",
    seniority: spec.seniority ?? null,
    dedupKey: spec.dedupKey ?? `key-${id}`,
    city: spec.city ?? "Paris",
    country: spec.country ?? "FR",
    remotePolicy: spec.remote ?? "HYBRID",
    hasSalary: spec.salary ?? false,
    firstSeenAt: at(spec.week, spec.day ?? 1),
    closedAt: spec.closedWeek === undefined ? null : at(spec.closedWeek, 2),
    reopenedAt: spec.reopenedWeek === undefined ? null : at(spec.reopenedWeek, 3),
    reopenCount: spec.reopenCount ?? (spec.reopenedWeek === undefined ? 0 : 1),
    duplicateOfId: spec.duplicateOf ?? null,
  };
}

/** `count` offres identiques (sauf identifiant et clé de déduplication). */
export function many(count: number, spec: Spec): HistoryOffer[] {
  return Array.from({ length: count }, () => offer(spec));
}

/**
 * Activité régulière : 5 offres à la première collecte, puis une nouvelle
 * offre par semaine, chacune fermée 3 semaines plus tard.
 */
export function steady(weeks = 10, base: Partial<Spec> = {}): HistoryOffer[] {
  return [
    ...many(5, { ...base, week: 0, closedWeek: 3 }),
    ...Array.from({ length: weeks - 1 }, (_, i) =>
      offer({ ...base, week: i + 1, closedWeek: i + 4 }),
    ),
  ];
}

/** Rien de notable : recrutement régulier pendant 10 semaines. */
export const nothingHappening = () => steady(10);

/** Pic : activité régulière puis 8 nouvelles offres la semaine 8. */
export const surge = () => [
  ...steady(8),
  ...many(8, { week: 8, title: "Développeur backend" }),
];

/** Le même pic, dont 5 offres sont des doublons d'une autre source. */
export const surgeWithDuplicates = () => {
  const history = steady(8);
  const canonical = many(3, { week: 8 });
  const duplicates = many(5, { week: 8, duplicateOf: canonical[0]!.id });
  return [...history, ...canonical, ...duplicates];
};

/**
 * Gel : 2 nouvelles offres par semaine jusqu'à la semaine 6, puis plus
 * aucune et fermeture de presque tout ce qui était ouvert (semaines 7–8).
 */
export const freeze = () => [
  ...many(6, { week: 0, closedWeek: 7 }),
  ...Array.from({ length: 6 }, (_, i) => many(2, { week: i + 1, closedWeek: i < 3 ? 5 : 8 })).flat(),
];

/** Republication : un poste fermé semaine 4 republié semaine 6, et une offre rouverte. */
export const repost = () => [
  ...steady(10),
  offer({ title: "Data analyst", week: 1, closedWeek: 4, dedupKey: "dataiku|data analyst|paris" }),
  offer({ title: "Data analyst", week: 6, dedupKey: "dataiku|data analyst|paris" }),
  offer({ title: "Account executive", week: 2, reopenedWeek: 6 }),
];

/** Nouvelle équipe (data + premier poste de direction) puis nouveaux lieux. */
export const newTeam = () => [
  ...steady(10),
  offer({ title: "Data scientist", week: 6 }),
  offer({ title: "Head of Data", week: 6 }),
  offer({ title: "Développeur backend", week: 7, city: "Lyon" }),
  offer({ title: "Développeur backend", week: 8, city: "Berlin", country: "DE" }),
];

/** Télétravail : offres sur site, puis uniquement hybrides à partir de la semaine 5. */
export const remoteShift = () => [
  ...many(5, { week: 0, remote: "ONSITE", closedWeek: 3 }),
  ...Array.from({ length: 4 }, (_, i) => offer({ week: i + 1, remote: "ONSITE" })),
  ...Array.from({ length: 5 }, (_, i) => many(2, { week: i + 5, remote: "HYBRID" })).flat(),
];

/** Entreprise récente : beaucoup d'offres mais deux semaines d'historique. */
export const tooYoung = () => [...many(10, { week: 7 }), ...many(10, { week: 8 })];

/** Entreprise ancienne mais avec seulement deux offres. */
export const tooFewOffers = () => [
  offer({ week: 0 }),
  offer({ week: 8, title: "Head of Data", city: "Berlin", country: "DE" }),
];
