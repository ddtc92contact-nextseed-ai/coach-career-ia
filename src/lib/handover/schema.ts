import { z } from "zod";
import { CV_MIME_TYPES, MAX_CV_BYTES, type IdentityData } from "@/lib/vault/identity";

/**
 * Levée d'anonymat : champs de l'identité que le candidat choisit de révéler
 * à UNE entreprise. Partagé par le navigateur (sélection, aperçu) et le
 * serveur (validation à la confirmation) : aucune dépendance serveur ici.
 *
 * Seuls les champs cochés quittent le navigateur, une seule fois, au moment
 * de la confirmation. Tout champ absent n'est pas révélé.
 */

export const HANDOVER_FIELDS = [
  "name",
  "email",
  "phone",
  "links",
  "employers",
  "schools",
  "cv",
] as const;
export type HandoverField = (typeof HANDOVER_FIELDS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
const httpUrl = /^https?:\/\/\S+$/i;

export const revealInput = z
  .object({
    name: z
      .object({
        firstName: z.string().trim().max(100).default(""),
        lastName: z.string().trim().max(100).default(""),
      })
      .refine((n) => n.firstName.length + n.lastName.length > 0, "empty")
      .optional(),
    email: text(254).optional(),
    phone: text(40).optional(),
    links: z
      .array(z.object({ label: z.string().trim().max(80).default(""), url: text(500) }))
      .min(1)
      .max(20)
      .optional(),
    employers: z
      .array(
        z.object({
          experienceId: z.string().max(64).nullable().default(null),
          name: text(160),
        }),
      )
      .min(1)
      .max(50)
      .optional(),
    schools: z
      .array(z.object({ name: text(160) }))
      .min(1)
      .max(30)
      .optional(),
  })
  .strict();

export type RevealInput = z.infer<typeof revealInput>;

/** Ce que l'entreprise voit (stocké chiffré) : la sélection, plus l'intitulé des postes et le CV. */
export type RevealedIdentity = Omit<RevealInput, "employers"> & {
  employers?: { name: string; role: string | null }[];
  cv?: { name: string; type: string; size: number };
};

/** Noms des champs révélés (journal, sans valeur). */
export function revealedFields(input: RevealInput, withCv: boolean): HandoverField[] {
  const fields = HANDOVER_FIELDS.filter(
    (f) => f !== "cv" && input[f as keyof RevealInput] !== undefined,
  );
  return withCv ? [...fields, "cv"] : fields;
}

/** Un lien n'est cliquable que s'il est en http(s). */
export const isHttpUrl = (value: string) => httpUrl.test(value);

export function isAllowedCv(file: { size: number; type: string }): boolean {
  return (
    file.size > 0 &&
    file.size <= MAX_CV_BYTES &&
    (CV_MIME_TYPES as readonly string[]).includes(file.type)
  );
}

/** Nom de fichier proposé au téléchargement : sans chemin ni caractère de contrôle. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return clean.slice(-120) || "cv";
}

/** Sélection de l'interface → données envoyées (navigateur uniquement). */
export type HandoverSelection = {
  name: boolean;
  email: boolean;
  phone: boolean;
  /** Indices dans `identity.links`. */
  links: number[];
  /** Indices dans `identity.employers`. */
  employers: number[];
  /** Indices dans `identity.schools`. */
  schools: number[];
  cv: boolean;
};

export const emptySelection = (): HandoverSelection => ({
  name: false,
  email: false,
  phone: false,
  links: [],
  employers: [],
  schools: [],
  cv: false,
});

export function buildReveal(identity: IdentityData, selection: HandoverSelection): RevealInput {
  const pick = <T>(items: T[], indexes: number[]) => items.filter((_, i) => indexes.includes(i));
  const out: RevealInput = {};
  if (selection.name && (identity.firstName || identity.lastName)) {
    out.name = { firstName: identity.firstName, lastName: identity.lastName };
  }
  if (selection.email && identity.email) out.email = identity.email;
  if (selection.phone && identity.phone) out.phone = identity.phone;
  const links = pick(identity.links, selection.links).filter((l) => l.url);
  if (links.length) out.links = links;
  const employers = pick(identity.employers, selection.employers).filter((e) => e.name);
  if (employers.length) out.employers = employers;
  const schools = pick(identity.schools, selection.schools).filter((s) => s.name);
  if (schools.length) out.schools = schools;
  return out;
}

/** Aperçu dans le navigateur : ce que verra l'entreprise (rôles joints localement). */
export function previewIdentity(
  reveal: RevealInput,
  roles: Record<string, string>,
  cv: { name: string; type: string; size: number } | null,
): RevealedIdentity {
  const { employers, ...rest } = reveal;
  return {
    ...rest,
    ...(employers
      ? {
          employers: employers.map((e) => ({
            name: e.name,
            role: (e.experienceId && roles[e.experienceId]) || null,
          })),
        }
      : {}),
    ...(cv ? { cv } : {}),
  };
}
