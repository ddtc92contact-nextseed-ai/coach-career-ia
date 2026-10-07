import type { AtsType } from "@/generated/prisma/enums";

/** Entreprise suivie via son job board ATS public. */
export type AtsCompany = {
  /** `Company.id` en base, renseigné par le job avant la collecte. */
  id?: string;
  slug: string;
  name: string;
  sector: string | null;
  atsType: AtsType;
  boardToken: string;
  /** Lever : « eu » pour api.eu.lever.co. */
  atsRegion: string | null;
};

export function atsKey(source: string, company: AtsCompany): string {
  return `${source}:${company.slug}`;
}

/** Un jeton de board ne doit contenir que des caractères sûrs pour une URL. */
export function boardPath(token: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(token)) throw new Error(`Jeton de board invalide : ${token}`);
  return encodeURIComponent(token);
}
