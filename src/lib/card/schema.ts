import { z } from "zod";
import { CONTRACT_TYPES, EVIDENCE_LEVELS, REMOTE_POLICIES, SENIORITIES } from "@/lib/career/codes";

/**
 * Carte de profil anonyme : ce qu'une entreprise voit du candidat avant toute
 * levée d'anonymat. Partagé par le serveur et le navigateur (aperçu, contrôle
 * local avec le coffre) : aucune dépendance serveur ici.
 *
 * Elle ne contient AUCUN champ d'identité : ni nom, ni contact, ni employeur,
 * ni école, ni date. Les textes libres viennent de la mémoire pseudonymisée et
 * des modifications du candidat ; le contrôle de ré-identification
 * (`reidentify.ts`) les vérifie avant chaque partage.
 */

export const CARD_LIMITS = {
  headline: 140,
  achievements: 6,
  achievementTitle: 160,
  achievementResult: 400,
  achievementSkills: 8,
  proofUrls: 3,
  skills: 24,
  skill: 60,
  locations: 5,
} as const;

const text = (max: number) => z.string().trim().max(max);

export const cardAchievementSchema = z.object({
  title: text(CARD_LIMITS.achievementTitle).min(1),
  result: text(CARD_LIMITS.achievementResult),
  evidenceLevel: z.enum(EVIDENCE_LEVELS),
  skills: z.array(text(CARD_LIMITS.skill).min(1)).max(CARD_LIMITS.achievementSkills),
  /** Liens publics des preuves : affichés seulement si `allowProofUrls`. */
  proofUrls: z.array(z.url({ protocol: /^https?$/ }).max(500)).max(CARD_LIMITS.proofUrls),
});

export const cardSchema = z.object({
  version: z.literal(1),
  headline: text(CARD_LIMITS.headline),
  seniority: z.enum(SENIORITIES).nullable(),
  /** Années d'expérience cumulées (arrondies), jamais de dates. */
  yearsOfExperience: z.number().int().min(0).max(60).nullable(),
  achievements: z.array(cardAchievementSchema).max(CARD_LIMITS.achievements),
  skills: z
    .array(z.object({ name: text(CARD_LIMITS.skill).min(1), proven: z.boolean() }))
    .max(CARD_LIMITS.skills),
  rails: z.object({
    /** Salaire fixe minimal attendu (€ brut annuel, arrondi au millier). */
    salaryFloor: z.number().int().min(0).max(10_000_000).nullable(),
    remotePolicy: z.enum(REMOTE_POLICIES).nullable(),
    minRemoteDays: z.number().int().min(0).max(5).nullable(),
    contractTypes: z.array(z.enum(CONTRACT_TYPES)).max(CONTRACT_TYPES.length),
    /** Zone de recherche (villes et rayon), pas une adresse. */
    locations: z
      .array(z.object({ label: text(120).min(1), radiusKm: z.number().int().min(0).max(1000) }))
      .max(CARD_LIMITS.locations),
  }),
  showSalary: z.boolean(),
  showLocations: z.boolean(),
  /** Le candidat autorise l'affichage des liens publics de ses preuves. */
  allowProofUrls: z.boolean(),
});

export type CardContent = z.infer<typeof cardSchema>;
export type CardAchievement = z.infer<typeof cardAchievementSchema>;

/** Lecture sûre d'une carte stockée (`null` si illisible). */
export function parseCard(value: unknown): CardContent | null {
  const parsed = cardSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Version publique : les liens de preuve et les garde-fous masqués sont retirés. */
export function publicCard(card: CardContent): CardContent {
  return {
    ...card,
    achievements: card.achievements.map((a) => ({
      ...a,
      proofUrls: card.allowProofUrls ? a.proofUrls : [],
    })),
    rails: {
      ...card.rails,
      salaryFloor: card.showSalary ? card.rails.salaryFloor : null,
      locations: card.showLocations ? card.rails.locations : [],
    },
  };
}
