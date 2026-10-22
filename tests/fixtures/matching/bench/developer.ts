/**
 * Développeur senior au profil RICHE : cinq réalisations prouvées, trois
 * expériences, sept compétences. Les offres voisines (data, support, chef
 * de projet) ont une similarité haute mais pas de stack commune ; les
 * offres lointaines annoncent un salaire au-dessus du package visé.
 */
import type { CandidateProfile } from "@/lib/matching/types";
import { atLevels, OPEN_RAILS, offer, salary, type BenchCase } from "./bench";

const profile: CandidateProfile = {
  seniority: "SENIOR",
  achievements: [
    {
      id: "dev-a-api",
      title: "Migration de l'API de paiement vers Node.js et TypeScript",
      text: "Migration de l'API de paiement vers Node.js et TypeScript. Temps de réponse divisé par deux. Node.js, TypeScript, PostgreSQL",
      evidenceLevel: "DOCUMENT",
      skills: ["Node.js", "TypeScript", "PostgreSQL"],
    },
    {
      id: "dev-a-k8s",
      title: "Passage de l'infrastructure sur Kubernetes",
      text: "Passage de l'infrastructure sur Kubernetes, déploiements continus. Kubernetes, Docker",
      evidenceLevel: "DOCUMENT",
      skills: ["Kubernetes", "Docker"],
    },
    {
      id: "dev-a-front",
      title: "Refonte du front de l'espace client en React",
      text: "Refonte du front de l'espace client en React, accessibilité. React, TypeScript",
      evidenceLevel: "DOCUMENT",
      skills: ["React", "TypeScript"],
    },
    {
      id: "dev-a-sql",
      title: "Optimisation des requêtes PostgreSQL du reporting",
      text: "Optimisation des requêtes PostgreSQL du reporting, index et partitions. PostgreSQL",
      evidenceLevel: "DOCUMENT",
      skills: ["PostgreSQL"],
    },
    {
      id: "dev-a-mentor",
      title: "Mentorat de quatre développeurs juniors",
      text: "Mentorat de quatre développeurs juniors, revues de code. TypeScript",
      evidenceLevel: "DOCUMENT",
      skills: ["TypeScript"],
    },
  ],
  experiences: [
    {
      id: "dev-e-lead",
      title: "Lead développeur backend",
      responsibilities: "Architecture des API Node.js, revues de code, astreintes.",
    },
    {
      id: "dev-e-fullstack",
      title: "Développeur full-stack senior",
      responsibilities: "Front React, API TypeScript, base PostgreSQL.",
    },
    {
      id: "dev-e-web",
      title: "Développeur web",
      responsibilities: "Sites et applications PHP, intégration.",
    },
  ],
  skills: [
    { name: "TypeScript", proven: true },
    { name: "Node.js", proven: true },
    { name: "PostgreSQL", proven: true },
    { name: "React", proven: true },
    { name: "Kubernetes", proven: true },
    { name: "Docker", proven: true },
    { name: "Rust", proven: false },
  ],
};

const distribution = [0.672, 0.665, 0.678, 0.681, 0.659, 0.684, 0.687, 0.676].map((median) => ({
  count: 18_000,
  median,
  p99: median + 0.12,
}));

const METIER = [
  ["Développeur backend senior Node.js / TypeScript", "API Node.js et TypeScript, base PostgreSQL, déploiement sur Kubernetes.", 1.35],
  ["Lead developer full-stack", "Stack React et Node.js, encadrement d'une équipe de cinq développeurs.", 1.25],
  ["Ingénieur logiciel senior", "Services TypeScript, PostgreSQL, Docker, revues de code exigeantes.", 1.2],
  ["Développeur full-stack React / Node.js", "Applications web React, API Node.js, tests automatisés.", 1.15],
  ["Tech lead backend", "Architecture des API, PostgreSQL, Kubernetes, mentorat.", 1.1],
] as const;

/** Voisins sémantiques : informatique, mais pas le métier (pas de stack commune). */
const VOISINS = [
  ["Data analyst", "Tableaux de bord Power BI et analyses Excel pour les équipes métier.", 0.95],
  ["Chef de projet digital", "Pilotage des projets web, recueil du besoin, recette fonctionnelle.", 0.9],
  ["Technicien support informatique", "Support utilisateurs, postes de travail Windows, ticketing.", 0.85],
  ["Product owner", "Backlog produit, ateliers utilisateurs, priorisation des évolutions.", 0.9],
] as const;

/** Lointains : salaire annoncé au-dessus du package, séniorité lisible. */
const HORS = [
  "Comptable senior",
  "Infirmier de bloc opératoire",
  "Conducteur de travaux",
  "Agent immobilier",
  "Responsable logistique",
  "Juriste droit social",
] as const;

export const DEVELOPER_CASE: BenchCase = {
  key: "developer",
  label: "développeur senior, profil riche",
  profile,
  rails: { ...OPEN_RAILS, minFixedSalary: 55_000, targetTotalPackage: 65_000 },
  distribution,
  offers: [
    ...METIER.map(([title, description, level], i) => ({
      offer: offer(`dev-metier-${i}`, { title, description }),
      family: "metier" as const,
      similarities: atLevels(distribution, level),
    })),
    ...VOISINS.map(([title, description, level], i) => ({
      offer: offer(`dev-voisin-${i}`, {
        title: `${title} senior`,
        description,
        seniority: "5 An(s)",
        ...salary(60_000, 70_000),
      }),
      family: "voisin" as const,
      similarities: atLevels(distribution, level),
    })),
    ...HORS.map((title, i) => ({
      offer: offer(`dev-hors-${i}`, {
        title,
        description: "Vous rejoignez une équipe dynamique et assurez le suivi des dossiers.",
        seniority: "5 An(s)",
        ...salary(66_000, 80_000),
      }),
      family: "hors" as const,
      similarities: atLevels(distribution, -0.3 + 0.15 * i),
    })),
  ],
  // Top 6 pour 5 offres du métier : un métier voisin à la séniorité lisible
  // peut s'intercaler (le contexte compte en entier dès que la pertinence est
  // haute, et la similarité sature au p99, issue #77).
  expectations: { metierInTop: 6, offTopicBelow: 40, businessTermShare: 0.8 },
};
