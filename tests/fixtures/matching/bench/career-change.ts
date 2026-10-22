/**
 * Reconversion : dix ans de professorat des écoles, puis une formation de
 * data analyst. Les compétences visées sont DÉCLARÉES, jamais prouvées (un
 * projet de formation sans pièce jointe). Le métier visé (data) doit
 * sortir en tête, l'ancien métier (enseignement) peut suivre, les métiers
 * lointains salariés restent en bas.
 */
import type { CandidateProfile } from "@/lib/matching/types";
import { atLevels, OPEN_RAILS, offer, salary, type BenchCase } from "./bench";

const profile: CandidateProfile = {
  seniority: "MID",
  achievements: [
    {
      id: "cc-a-dashboard",
      title: "Projet de formation : tableau de bord des ventes",
      text: "Projet de formation : tableau de bord des ventes d'une enseigne, nettoyage des données. Python, SQL, Power BI",
      evidenceLevel: "DECLARED",
      skills: ["Python", "SQL", "Power BI"],
    },
  ],
  experiences: [
    {
      id: "cc-e-teacher",
      title: "Professeur des écoles",
      responsibilities: "Enseignement en classe de CM1-CM2, projets pédagogiques, relations avec les familles.",
    },
  ],
  skills: [
    { name: "Python", proven: false },
    { name: "SQL", proven: false },
    { name: "Power BI", proven: false },
    { name: "Analyse de données", proven: false },
  ],
};

/** Réalisation (data), puis expérience (enseignement). */
const distribution = [
  { count: 18_000, median: 0.671, p99: 0.782 },
  { count: 18_000, median: 0.664, p99: 0.776 },
];

const METIER = [
  ["Data analyst junior", "Analyse de données commerciales en SQL et Python, tableaux de bord Power BI.", [1.2, 0.2]],
  ["Analyste données", "Requêtes SQL, reporting Power BI pour les équipes marketing.", [1.15, 0.1]],
  ["Chargé de reporting BI", "Construction des tableaux de bord Power BI et fiabilisation des données.", [1.05, 0.15]],
] as const;

/** Ancien métier : légitime, mais pas l'objectif. */
const VOISINS = [
  ["Professeur des écoles", "Enseignement en école élémentaire, classe de CE2.", [0.1, 1.4]],
  ["Formateur bureautique", "Animation de formations Excel et Word pour adultes.", [0.6, 0.9]],
] as const;

const HORS = [
  "Commercial terrain",
  "Agent de sécurité",
  "Conducteur de bus",
  "Assistant comptable",
  "Vendeur en magasin",
  "Gestionnaire de paie",
] as const;

export const CAREER_CHANGE_CASE: BenchCase = {
  key: "career-change",
  label: "reconversion, compétences déclarées non prouvées",
  profile,
  rails: { ...OPEN_RAILS, minFixedSalary: 30_000, targetTotalPackage: 34_000 },
  distribution,
  offers: [
    ...METIER.map(([title, description, levels], i) => ({
      offer: offer(`cc-metier-${i}`, { title, description, seniority: "Débutant accepté" }),
      family: "metier" as const,
      similarities: atLevels(distribution, [...levels]),
    })),
    ...VOISINS.map(([title, description, levels], i) => ({
      offer: offer(`cc-voisin-${i}`, { title, description }),
      family: "voisin" as const,
      similarities: atLevels(distribution, [...levels]),
    })),
    ...HORS.map((title, i) => ({
      offer: offer(`cc-hors-${i}`, {
        title,
        description: "Vous rejoignez une équipe dynamique et assurez le suivi des dossiers.",
        seniority: "2 An(s)",
        ...salary(34_000, 40_000),
      }),
      family: "hors" as const,
      similarities: atLevels(distribution, -0.3 + 0.15 * i),
    })),
  ],
  // Top 4 pour 3 offres visées : l'ancien métier peut s'intercaler.
  expectations: {
    metierInTop: 4,
    offTopicBelow: 40,
    businessTermShare: 0.75,
    // Compétences déclarées : l'explication le dit.
    metierGap: "unprovenSkill",
  },
};
