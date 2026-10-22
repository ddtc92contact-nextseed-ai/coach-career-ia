/**
 * Reproduction de la prod du 22/10 après #75 (issue #77), FICTIVE mais
 * fidèle : le profil audiovisuel de `audiovisual.ts` (3 expériences de
 * technicien audiovisuel, 1 réalisation, 1 compétence, plancher 30 k€), et
 * les distributions mesurées avec mistral-embed, élément par élément :
 *
 * | élément  | médiane | p99   | max BTP/commis | max audiovisuel |
 * |----------|---------|-------|----------------|-----------------|
 * | df877d52 | 0,680   | 0,776 | 0,791          | 0,795           |
 * | ea62e148 | 0,691   | 0,784 | 0,792          | 0,794           |
 * | 186569e8 | 0,670   | 0,778 | 0,798          | 0,827           |
 * | 10710d63 | 0,689   | 0,787 | 0,795          | 0,842           |
 *
 * Des offres du BTP et de commis, à 0,79-0,80 sur CHAQUE élément (pire cas),
 * sans aucun terme du métier du candidat, AVEC un salaire au niveau du
 * package et une séniorité lisible ; les 3 offres audiovisuelles, de 0,79 à
 * 0,84, sans salaire ni séniorité. Le fond (le reste des ~18 000 offres)
 * suit la distribution mesurée.
 */
import type { MatchOffer } from "@/lib/matching/types";
import { AV_OFFERS, AV_PROFILE } from "./audiovisual";

/** Lignes du tableau de prod (élément anonymisé → distribution et maxima observés). */
export const PROD_ROWS = [
  { item: "df877d52", median: 0.68, p99: 0.776, av: [0.795, 0.793, 0.79] },
  { item: "ea62e148", median: 0.691, p99: 0.784, av: [0.794, 0.792, 0.79] },
  { item: "186569e8", median: 0.67, p99: 0.778, av: [0.827, 0.818, 0.808] },
  { item: "10710d63", median: 0.689, p99: 0.787, av: [0.842, 0.833, 0.822] },
] as const;

/** Éléments de la mémoire du profil : la réalisation, puis les trois expériences. */
export const MEMORY_IDS = [
  "av-achievement",
  ...(AV_PROFILE.experiences ?? []).map((e) => e.id),
] as const;

const BTP_TITLES = [
  "Maçon VRD H/F",
  "Coffreur bancheur",
  "Conducteur d'engins de chantier",
  "Commis de cuisine",
  "Manœuvre gros œuvre",
  "Canalisateur H/F",
  "Commis de salle",
  "Chef d'équipe maçonnerie",
  "Plombier chauffagiste",
  "Carreleur faïencier",
  "Aide-maçon",
  "Grutier à tour",
  "Ferrailleur béton armé",
  "Commis de cuisine collective",
  "Poseur de voirie",
  "Charpentier bois",
  "Couvreur zingueur",
  "Peintre en bâtiment",
  "Plaquiste jointeur",
  "Commis boucher",
  "Terrassier H/F",
  "Coffreur génie civil",
  "Conducteur de pelle hydraulique",
  "Commis pâtissier",
  "Maçon finisseur",
  "Menuisier poseur",
  "Étancheur H/F",
  "Commis traiteur",
  "Chef de chantier VRD",
  "Compagnon maçon",
];

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

/**
 * Trente offres du BTP et de commis : salaire au niveau du package visé
 * (35 k€), séniorité lisible (« 3 An(s) »), aucun terme du métier du candidat.
 */
export const BTP_OFFERS: MatchOffer[] = BTP_TITLES.map((title, i) =>
  offer(`btp-${i}`, {
    title,
    description:
      "Au sein d'une entreprise de travaux publics, vous intervenez sur nos chantiers : préparation, réalisation des ouvrages, respect des consignes de sécurité. Horaires de journée, poste à pourvoir rapidement.",
    seniority: "3 An(s)",
    salaryMin: 32000,
    salaryMax: 36000,
    salaryCurrency: "EUR",
    salaryPeriod: "YEAR",
  }),
);

/** Les trois offres audiovisuelles, sans salaire ni séniorité (comme en prod). */
export { AV_OFFERS };

/** Offres de fond : le reste de la base, qui sert seulement à la calibration. */
export const BACKGROUND_COUNT = 18_000;

/** Inverse de la loi normale centrée réduite (Acklam, précision ~1e-9 suffisante ici). */
function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269];
  const a2 = [-30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972];
  const b2 = -13.28068155288572;
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734];
  const c2 = [4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) =>
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c2[0]!) * q + c2[1]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a2[0]!) * r + a2[1]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b2) * r + 1)
  );
}

/**
 * Similarités, élément par élément, selon une attribution des lignes du
 * tableau aux éléments de la mémoire (`assignment[k]` : ligne de l'élément
 * k ; par défaut dans l'ordre). Renvoie les similarités des offres notées
 * (BTP et audiovisuel) et la distribution complète de chaque élément (fond
 * compris), comme `memorySimilarityStats` la lit en SQL.
 */
export function prodSimilarities(assignment: readonly number[] = [0, 1, 2, 3]) {
  const offers = new Map<string, Map<string, number>>();
  const distributions = new Map<string, number[]>();
  MEMORY_IDS.forEach((id, k) => {
    const row = PROD_ROWS[assignment[k]!]!;
    // Loi normale de même médiane et même p99 (z = 2,326), queue haute fine
    // (les offres de fond restent sous les offres BTP, comme en prod).
    const sigma = (row.p99 - row.median) / 2.326;
    const values = Array.from({ length: BACKGROUND_COUNT }, (_, i) =>
      Math.min(row.median + sigma * probit((i + 0.5) / BACKGROUND_COUNT), 0.789),
    );
    BTP_OFFERS.forEach((o, i) => {
      const sim = 0.79 + (0.01 * ((i * 7 + k * 3) % BTP_OFFERS.length)) / (BTP_OFFERS.length - 1);
      values.push(sim);
      if (!offers.has(o.id)) offers.set(o.id, new Map());
      offers.get(o.id)!.set(id, sim);
    });
    AV_OFFERS.forEach((o, i) => {
      values.push(row.av[i]!);
      if (!offers.has(o.id)) offers.set(o.id, new Map());
      offers.get(o.id)!.set(id, row.av[i]!);
    });
    distributions.set(id, values);
  });
  return { offers, distributions };
}
