import { z } from "zod";

/**
 * Contenu (clair) du coffre d'identité. N'existe QUE dans le navigateur :
 * le serveur ne reçoit que sa version chiffrée (`encryptJson`).
 */

const text = (max: number) => z.string().trim().max(max).default("");

export const identityEmployer = z.object({
  /** Expérience de la mémoire de carrière correspondante (jointure côté navigateur). */
  experienceId: z.string().max(64).nullable().default(null),
  name: text(160),
});

export const identitySchool = z.object({ name: text(160) });

export const identityLink = z.object({ label: text(80), url: text(500) });

export const identityData = z.object({
  firstName: text(100),
  lastName: text(100),
  email: text(254),
  phone: text(40),
  employers: z.array(identityEmployer).max(50).default([]),
  schools: z.array(identitySchool).max(30).default([]),
  links: z.array(identityLink).max(20).default([]),
});

export type IdentityData = z.infer<typeof identityData>;
export type IdentityEmployer = z.infer<typeof identityEmployer>;

export const emptyIdentity = (): IdentityData => identityData.parse({});

/** Nom réel de l'employeur d'une expérience, s'il est renseigné dans le coffre. */
export function employerForExperience(
  identity: IdentityData | null,
  experienceId: string,
): string | null {
  const name = identity?.employers.find((e) => e.experienceId === experienceId)?.name;
  return name ? name : null;
}

/** Taille maximale du CV d'origine (avant chiffrement). */
export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const CV_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.oasis.opendocument.text",
] as const;
