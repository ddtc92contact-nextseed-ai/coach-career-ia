/**
 * Technicien audiovisuel au profil MINCE : le cas du fondateur (prod du
 * 22/10, version 45243ea, issue #77). Trois expériences anciennes, une
 * réalisation déclarée, une compétence, plancher 30 k€, aucun lieu.
 * Distribution et similarités mesurées avec mistral-embed : offres du BTP
 * et de commis à 0,79-0,80 (au-dessus du p99 de chaque élément), offres
 * audiovisuelles à 0,79-0,84.
 */
import { AV_OFFERS, AV_PROFILE, AV_RAILS, OFF_TOPIC_OFFERS } from "../audiovisual";
import { atLevels, offer, salary, type BenchCase } from "./bench";

/** Éléments de la mémoire (réalisation, puis les trois expériences) : tableau de l'issue #77. */
const distribution = [
  { count: 18_000, median: 0.68, p99: 0.776 },
  { count: 18_000, median: 0.691, p99: 0.784 },
  { count: 18_000, median: 0.67, p99: 0.778 },
  { count: 18_000, median: 0.689, p99: 0.787 },
];

const AV_SIMILARITIES: Record<string, number[]> = {
  "av-expert": [0.795, 0.794, 0.827, 0.842],
  "av-ingenieur": [0.792, 0.79, 0.815, 0.828],
  "av-support": [0.79, 0.789, 0.806, 0.819],
};

/** BTP et commis : en tête de la prod, salaire annoncé et séniorité lisible. */
const BTP = [
  ["Maçon VRD", "Vous réalisez les travaux de voirie et réseaux divers sur nos chantiers."],
  ["Coffreur bancheur", "Vous assurez le coffrage et le ferraillage des ouvrages en béton."],
  ["Conducteur d'engins", "Vous conduisez pelles et chargeuses sur les chantiers de terrassement."],
  ["Commis de cuisine", "Vous préparez les entrées et assurez la mise en place du service."],
  ["Canalisateur", "Vous posez les réseaux d'eau potable et d'assainissement."],
  ["Plaquiste", "Vous posez cloisons, doublages et faux plafonds en plaques de plâtre."],
  ["Commis de salle", "Vous dressez les tables et accompagnez le chef de rang pendant le service."],
  ["Manœuvre BTP", "Vous approvisionnez les postes de travail et nettoyez le chantier."],
] as const;

const btpSimilarities = (i: number) => {
  const max = [0.791, 0.792, 0.798, 0.795];
  return max.map((m) => Math.round((m - 0.0015 * i) * 1000) / 1000);
};

export const AUDIOVISUAL_CASE: BenchCase = {
  key: "audiovisual",
  label: "technicien audiovisuel, profil mince (cas du fondateur)",
  profile: AV_PROFILE,
  rails: AV_RAILS,
  distribution,
  offers: [
    ...AV_OFFERS.map((o) => ({
      offer: o,
      family: "metier" as const,
      similarities: AV_SIMILARITIES[o.id]!,
    })),
    ...BTP.map(([title, description], i) => ({
      offer: offer(`btp-${i}`, {
        title: `${title} H/F`,
        description: `${description} Expérience de 1 an souhaitée.`,
        seniority: "1 An(s)",
        ...salary(32_000, 36_000),
      }),
      family: "hors" as const,
      similarities: btpSimilarities(i),
    })),
    // Le reste de la base : hors sujet, entre la médiane et le p97 (salaire annoncé).
    ...OFF_TOPIC_OFFERS.map((o, i) => ({
      offer: o,
      family: "hors" as const,
      similarities: atLevels(distribution, -0.4 + (1.1 * i) / (OFF_TOPIC_OFFERS.length - 1)),
    })),
  ],
  expectations: { metierInTop: 3, offTopicBelow: 75, businessTermShare: 1 },
  todo: "#77",
};
