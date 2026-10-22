/**
 * Profil du journal de prod du 22/10 (issue #72), FICTIF mais fidèle : trois
 * expériences de technicien audiovisuel, une réalisation, une compétence,
 * plancher 30 k€ et package visé 35 k€, aucun lieu. Les similarités cosinus
 * sont fixées à la main pour reproduire la distribution mesurée avec
 * mistral-embed (min 0,576, médiane 0,681, p99 0,776, max 0,802 ; offres du
 * métier entre 0,776 et 0,795).
 */
import type { CandidateProfile, CandidateRails, MatchOffer } from "@/lib/matching/types";

export const AV_PROFILE: CandidateProfile = {
  seniority: "MID",
  achievements: [
    {
      id: "av-achievement",
      title: "Exploitation de la régie vidéo d'un plateau en direct",
      text: "Exploitation de la régie vidéo d'un plateau en direct. Mélangeur, grille d'antenne, contrôle des signaux. Gestionnaire régie audiovisuel",
      evidenceLevel: "DECLARED",
      skills: ["Gestionnaire régie audiovisuel"],
    },
  ],
  experiences: [
    {
      id: "av-exp-video",
      title: "Technicien vidéo",
      responsibilities: "Exploitation broadcast, transcodage des programmes, contrôle qualité des signaux.",
    },
    {
      id: "av-exp-regie",
      title: "Technicien régie",
      responsibilities: "Régie finale, diffusion des programmes, maintenance des équipements.",
    },
    {
      id: "av-exp-exploitation",
      title: "Technicien d'exploitation audiovisuel",
      responsibilities: "Exploitation des moyens techniques de tournage et de montage.",
    },
  ],
  skills: [{ name: "Gestionnaire régie audiovisuel", proven: false }],
};

export const AV_RAILS: CandidateRails = {
  minFixedSalary: 30000,
  targetTotalPackage: 35000,
  remotePolicy: null,
  minRemoteDays: null,
  contractTypes: [],
  excludedSectors: [],
  excludedCompanies: [],
  maxWeeklyHours: null,
  acceptsOnCall: true,
  acceptsRemoteOutsideZone: false,
  culturePreferences: [],
  locations: [],
};

const MEMORY_IDS = [
  "av-achievement",
  ...(AV_PROFILE.experiences ?? []).map((e) => e.id),
] as const;

function offer(id: string, overrides: Partial<MatchOffer>): MatchOffer {
  return {
    id,
    title: "Poste",
    description: "",
    companyName: "Entreprise Exemple",
    sector: null,
    seniority: null,
    contractLabel: null,
    latitude: 48.85,
    longitude: 2.35,
    remotePolicy: "ONSITE",
    contractType: "CDI",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    ...overrides,
  };
}

/** Les trois offres du métier, SANS salaire annoncé. */
export const AV_OFFERS: MatchOffer[] = [
  offer("av-ingenieur", {
    title: "Ingénieur Audiovisuel H/F",
    description:
      "Au sein du service technique, vous concevez et exploitez les installations audiovisuelles des salles de conférence.",
  }),
  offer("av-support", {
    title: "Support Audiovisuel H/F",
    description:
      "Vous assurez le support des équipements audiovisuels et la diffusion vidéo lors des événements.",
  }),
  offer("av-expert", {
    title: "Expert Audiovisuel (H/F)",
    description: "Vous pilotez la régie et les moyens de captation vidéo de nos plateaux.",
  }),
];

const OFF_TOPIC_TITLES = [
  "Post-doctorant en biologie cellulaire",
  "Agent immobilier H/F",
  "Comptable unique H/F",
  "Chef de secteur GMS",
  "Technicien de maintenance industrielle",
  "Gestionnaire de paie",
  "Commercial terrain B2B",
  "Assistant de direction",
  "Infirmier de bloc opératoire",
  "Juriste droit social",
  "Responsable logistique",
  "Conseiller clientèle bancaire",
  "Chargé de recrutement",
  "Acheteur industriel",
  "Contrôleur de gestion",
  "Chef de rayon",
  "Développeur Java",
  "Électricien du bâtiment",
  "Responsable qualité",
  "Chauffeur poids lourd",
];

/**
 * Vingt offres hors sujet AVEC un salaire annoncé au-dessus du package visé
 * et une séniorité lisible (« confirmé ») : ce qui les plaçait en tête.
 */
export const OFF_TOPIC_OFFERS: MatchOffer[] = OFF_TOPIC_TITLES.map((title, i) =>
  offer(`off-${i}`, {
    title: `${title} confirmé`,
    description:
      "Vous rejoignez une équipe dynamique. Vous assurez le suivi des dossiers et la relation avec les clients. Expérience de 3 ans.",
    seniority: "3 An(s)",
    salaryMin: 38000,
    salaryMax: 45000,
    salaryCurrency: "EUR",
    salaryPeriod: "YEAR",
  }),
);

/** Offres anonymes qui complètent la distribution (le reste des ~18 000 offres). */
export const BACKGROUND_OFFERS: MatchOffer[] = Array.from({ length: 400 }, (_, i) =>
  offer(`bg-${i}`, { title: `Poste ${i}`, description: "Description sans rapport." }),
);

// Distribution normale tronquée de la prod : médiane 0,681, écart-type ≈ 0,04.
function quantile(p: number): number {
  // Approximation de l'inverse de la loi normale (Acklam simplifiée, suffisante ici).
  const a = [-39.6968, 220.9461, -275.9285, 138.358, -30.6648, 2.5066];
  const b = [-54.4761, 161.5858, -155.699, 66.8013, -13.2806];
  const q = p - 0.5;
  const r = q * q;
  const z =
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  return Math.min(0.802, Math.max(0.576, 0.681 + 0.0408 * z));
}

/**
 * Similarités cosinus offre ↔ élément de la mémoire. Les offres du métier
 * sont dans le top 1 % (0,776 à 0,795) ; les offres hors sujet entre la
 * médiane et le 97e centile (0,64 à 0,748) ; le fond (le reste de la base,
 * qui sert à la calibration) suit la distribution mesurée.
 */
export function avSimilarities(): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  const set = (offerId: string, base: number) =>
    result.set(
      offerId,
      new Map(MEMORY_IDS.map((id, k) => [id, base - 0.004 * k] as const)),
    );
  AV_OFFERS.forEach((o, i) => set(o.id, 0.795 - 0.009 * i));
  OFF_TOPIC_OFFERS.forEach((o, i) => set(o.id, 0.64 + (0.108 * i) / (OFF_TOPIC_OFFERS.length - 1)));
  BACKGROUND_OFFERS.forEach((o, i) => set(o.id, quantile((i + 0.5) / BACKGROUND_OFFERS.length)));
  return result;
}
