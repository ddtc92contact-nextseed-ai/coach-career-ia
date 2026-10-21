import { z } from "zod";
import type { IdentityPayload } from "@/lib/import/shared";

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

const LIMITS = {
  name: 100,
  email: 254,
  phone: 40,
  org: 160,
  label: 80,
  url: 500,
  employers: 50,
  schools: 30,
  links: 20,
};

const clip = (value: string, max: number) => value.trim().slice(0, max);
const sameText = (a: string, b: string) =>
  a.trim().toLocaleLowerCase("fr") === b.trim().toLocaleLowerCase("fr");

/** Libellé d'un lien personnel : son domaine (`linkedin.com`), sinon vide. */
function linkLabel(url: string): string {
  for (const candidate of [url, `https://${url}`]) {
    try {
      return new URL(candidate).hostname.replace(/^www\./, "");
    } catch {
      // Essai suivant.
    }
  }
  return "";
}

/**
 * Ajoute au coffre les données identifiantes repérées par l'import (dans le
 * navigateur, avant chiffrement). Rien de ce que le candidat a déjà saisi
 * n'est écrasé : les champs vides sont complétés, les listes enrichies sans
 * doublon. `experienceIds` relie chaque employeur à l'expérience créée par
 * l'import (`ref` du brouillon → identifiant) ; un employeur déjà présent mais
 * pas encore relié l'est au passage. L'opération est idempotente.
 */
export function mergeImportedIdentity(
  current: IdentityData,
  imported: IdentityPayload,
  experienceIds: Record<string, string> = {},
): IdentityData {
  const next: IdentityData = {
    ...current,
    employers: current.employers.map((e) => ({ ...e })),
    schools: [...current.schools],
    links: [...current.links],
  };

  if (imported.fullName && !next.firstName && !next.lastName) {
    const [first = "", ...rest] = imported.fullName.trim().split(/\s+/);
    next.firstName = clip(first, LIMITS.name);
    next.lastName = clip(rest.join(" "), LIMITS.name);
  }
  if (!next.email && imported.emails[0]) next.email = clip(imported.emails[0], LIMITS.email);
  if (!next.phone && imported.phones[0]) next.phone = clip(imported.phones[0], LIMITS.phone);

  for (const employer of imported.employers) {
    const name = clip(employer.name, LIMITS.org);
    if (!name) continue;
    const experienceId = (employer.experienceRef && experienceIds[employer.experienceRef]) || null;
    const existing = next.employers.find(
      (e) =>
        sameText(e.name, name) &&
        (e.experienceId === experienceId || e.experienceId === null || experienceId === null),
    );
    if (existing) {
      existing.experienceId ??= experienceId;
    } else if (next.employers.length < LIMITS.employers) {
      next.employers.push({ name, experienceId });
    }
  }

  for (const school of imported.schools) {
    const name = clip(school.name, LIMITS.org);
    if (!name || next.schools.some((s) => sameText(s.name, name))) continue;
    if (next.schools.length < LIMITS.schools) next.schools.push({ name });
  }

  for (const link of imported.links) {
    const url = clip(link, LIMITS.url);
    if (!url || next.links.some((l) => sameText(l.url, url))) continue;
    if (next.links.length < LIMITS.links) {
      next.links.push({ label: clip(linkLabel(url), LIMITS.label), url });
    }
  }
  return next;
}

/** L'import a repéré au moins une donnée que le coffre sait conserver. */
export function hasVaultableIdentity(imported: IdentityPayload): boolean {
  return Boolean(
    imported.fullName ||
    imported.emails.length ||
    imported.phones.length ||
    imported.employers.length ||
    imported.schools.length ||
    imported.links.length,
  );
}

/** Taille maximale du CV d'origine (avant chiffrement). */
export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const CV_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.oasis.opendocument.text",
] as const;
