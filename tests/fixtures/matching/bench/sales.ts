/**
 * Commercial B2B confirmé : trois réalisations (deux prouvées), trois
 * expériences, cinq compétences. Les métiers de la relation client
 * (téléconseiller, assistant commercial) sont proches sémantiquement ; les
 * métiers lointains annoncent un salaire au-dessus du package visé.
 */
import type { CandidateProfile } from "@/lib/matching/types";
import { atLevels, OPEN_RAILS, offer, salary, type BenchCase } from "./bench";

const profile: CandidateProfile = {
  seniority: "MID",
  achievements: [
    {
      id: "sales-a-accounts",
      title: "Ouverture de douze grands comptes industriels",
      text: "Ouverture de douze grands comptes industriels en deux ans. Prospection, Négociation commerciale, Grands comptes",
      evidenceLevel: "DOCUMENT",
      skills: ["Prospection", "Négociation commerciale", "Grands comptes"],
    },
    {
      id: "sales-a-crm",
      title: "Déploiement de Salesforce pour l'équipe commerciale",
      text: "Déploiement de Salesforce pour l'équipe commerciale, pipeline fiabilisé. Salesforce",
      evidenceLevel: "DOCUMENT",
      skills: ["Salesforce"],
    },
    {
      id: "sales-a-quota",
      title: "Objectif annuel dépassé de 30 %",
      text: "Objectif annuel de chiffre d'affaires dépassé de 30 %. Négociation commerciale",
      evidenceLevel: "DECLARED",
      skills: ["Négociation commerciale"],
    },
  ],
  experiences: [
    {
      id: "sales-e-ic",
      title: "Ingénieur commercial",
      responsibilities: "Vente de solutions industrielles aux grands comptes, cycles longs.",
    },
    {
      id: "sales-e-b2b",
      title: "Commercial B2B",
      responsibilities: "Prospection terrain des PME, rendez-vous, devis et closing.",
    },
    {
      id: "sales-e-bizdev",
      title: "Business developer",
      responsibilities: "Prospection téléphonique, génération de leads, salons professionnels.",
    },
  ],
  skills: [
    { name: "Prospection", proven: true },
    { name: "Négociation commerciale", proven: true },
    { name: "Grands comptes", proven: true },
    { name: "Salesforce", proven: true },
    { name: "Anglais professionnel", proven: false },
  ],
};

const distribution = [0.676, 0.668, 0.681, 0.684, 0.679, 0.672].map((median) => ({
  count: 18_000,
  median,
  p99: median + 0.11,
}));

const METIER = [
  ["Business developer SaaS B2B", "Prospection de nouveaux clients B2B, négociation et closing.", 1.3],
  ["Ingénieur commercial grands comptes", "Développement d'un portefeuille de grands comptes industriels.", 1.3],
  ["Account executive", "Cycle de vente complet auprès des ETI, pipeline Salesforce.", 1.15],
  ["Commercial terrain B2B", "Prospection des entreprises de votre secteur, rendez-vous et devis.", 1.2],
  ["Key account manager", "Gestion et développement des comptes clés, négociation annuelle.", 1.1],
] as const;

/** Relation client : proche sémantiquement, sans vente complexe. */
const VOISINS = [
  ["Téléconseiller", "Réception des appels clients, traitement des réclamations.", 0.95],
  ["Assistant commercial", "Saisie des commandes, relances et suivi administratif des ventes.", 1],
  ["Chargé de marketing", "Campagnes e-mailing, salons et contenus pour les commerciaux.", 0.9],
] as const;

const HORS = [
  "Développeur Java",
  "Infirmier de nuit",
  "Comptable fournisseurs",
  "Chauffeur poids lourd",
  "Technicien de maintenance",
  "Préparateur de commandes",
] as const;

export const SALES_CASE: BenchCase = {
  key: "sales",
  label: "commercial B2B",
  profile,
  rails: { ...OPEN_RAILS, minFixedSalary: 40_000, targetTotalPackage: 55_000 },
  distribution,
  offers: [
    ...METIER.map(([title, description, level], i) => ({
      offer: offer(`sales-metier-${i}`, { title, description }),
      family: "metier" as const,
      similarities: atLevels(distribution, level),
    })),
    ...VOISINS.map(([title, description, level], i) => ({
      offer: offer(`sales-voisin-${i}`, {
        title,
        description,
        seniority: "3 An(s)",
        ...salary(42_000, 50_000),
      }),
      family: "voisin" as const,
      similarities: atLevels(distribution, level),
    })),
    ...HORS.map((title, i) => ({
      offer: offer(`sales-hors-${i}`, {
        title: `${title} confirmé`,
        description: "Vous rejoignez une équipe dynamique et assurez le suivi des dossiers.",
        seniority: "3 An(s)",
        ...salary(55_000, 65_000),
      }),
      family: "hors" as const,
      similarities: atLevels(distribution, -0.3 + 0.15 * i),
    })),
  ],
  // Top 6 pour 5 offres du métier : un métier voisin à la séniorité lisible
  // peut s'intercaler (le contexte compte en entier dès que la pertinence est
  // haute, et la similarité sature au p99, issue #77).
  expectations: { metierInTop: 6, offTopicBelow: 40, businessTermShare: 1 },
};
