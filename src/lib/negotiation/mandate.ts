import { z } from "zod";
import { CONTRACT_TYPES, type ContractTypeCode } from "@/lib/career/codes";

/**
 * Mandat de négociation : ce que le candidat autorise son agent à demander.
 * Plancher (jamais franchi), cible, points non négociables et souhaitables,
 * et les seuls faits que l'agent peut avancer en plus de la mémoire de
 * carrière (une offre concurrente, par exemple, n'est citée que si elle est
 * déclarée ici).
 *
 * Module sans dépendance serveur : partagé avec le formulaire.
 */

export const NEGOTIATION_OUTCOMES = ["ACTIVE", "PAUSED", "ACCEPTED", "DECLINED"] as const;
export type NegotiationOutcome = (typeof NEGOTIATION_OUTCOMES)[number];

export const MIN_SALARY = 10_000;
export const MAX_SALARY = 1_000_000;
export const MAX_POINTS = 10;
export const MAX_POINT_LENGTH = 200;
export const MAX_FACTS = 1_000;
/** Longueur maximale d'un message de négociation. */
export const MAX_MESSAGE = 3000;

const salary = z.number().int().min(MIN_SALARY).max(MAX_SALARY);
const shortText = z.string().trim().min(2).max(120).nullable();
const points = z.array(z.string().trim().min(2).max(MAX_POINT_LENGTH)).max(MAX_POINTS);

export const mandateSchema = z
  .object({
    /** Rémunération fixe annuelle brute minimale (euros). */
    salaryFloor: salary,
    /** Rémunération visée (≥ plancher). */
    salaryTarget: salary.nullable(),
    // --- Non négociables ---
    remoteDaysMin: z.number().int().min(0).max(5).nullable(),
    location: shortText,
    contractType: z.enum(CONTRACT_TYPES).nullable(),
    /** Prise de poste au plus tôt (AAAA-MM-JJ). */
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => !Number.isNaN(Date.parse(v)))
      .nullable(),
    title: shortText,
    otherPoints: points,
    // --- Souhaitables ---
    niceToHave: points,
    /** Faits que l'agent peut mentionner (offre concurrente, contraintes…). */
    facts: z.string().trim().max(MAX_FACTS).nullable(),
  })
  .refine((m) => m.salaryTarget === null || m.salaryTarget >= m.salaryFloor, {
    path: ["salaryTarget"],
    message: "belowFloor",
  });

export type Mandate = z.infer<typeof mandateSchema>;

export const MANDATE_FIELDS = [
  "salaryFloor",
  "salaryTarget",
  "remoteDaysMin",
  "location",
  "contractType",
  "startDate",
  "title",
  "otherPoints",
  "niceToHave",
  "facts",
] as const;
export type MandateField = (typeof MANDATE_FIELDS)[number];

/** Valeurs par défaut : plancher et conditions des garde-fous. */
export function defaultMandate(rails: {
  minFixedSalary: number | null;
  targetTotalPackage: number | null;
  minRemoteDays: number | null;
  contractTypes: ContractTypeCode[];
}): Partial<Mandate> {
  return {
    salaryFloor: rails.minFixedSalary ?? undefined,
    salaryTarget:
      rails.targetTotalPackage && rails.targetTotalPackage >= (rails.minFixedSalary ?? 0)
        ? rails.targetTotalPackage
        : null,
    remoteDaysMin: rails.minRemoteDays,
    contractType: rails.contractTypes.length === 1 ? rails.contractTypes[0]! : null,
  };
}

const blank = (v: unknown) => (typeof v === "string" ? v.trim() : "") === "";

/** Montant saisi (« 55 000 », « 55k ») → entier, ou la saisie brute si illisible. */
function amount(v: unknown): unknown {
  if (blank(v)) return null;
  const raw = String(v).trim().toLowerCase().replace(/€|eur/g, "").trim();
  const k = raw.endsWith("k");
  const digits = (k ? raw.slice(0, -1) : raw).replace(/[\s  .,'’]/g, "");
  if (!/^\d+$/.test(digits)) return raw;
  return Number(digits) * (k ? 1000 : 1);
}

const integer = (v: unknown) => (blank(v) ? null : Number(String(v).trim()));
const text = (v: unknown) => (blank(v) ? null : String(v).trim());
const lines = (v: unknown) =>
  typeof v === "string"
    ? v
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
        .filter(Boolean)
    : [];

/** Champs du formulaire (texte) → objet à valider par `mandateSchema`. */
export function mandateFromForm(get: (name: MandateField) => unknown): unknown {
  return {
    salaryFloor: amount(get("salaryFloor")),
    salaryTarget: amount(get("salaryTarget")),
    remoteDaysMin: integer(get("remoteDaysMin")),
    location: text(get("location")),
    contractType: text(get("contractType")),
    startDate: text(get("startDate")),
    title: text(get("title")),
    otherPoints: lines(get("otherPoints")),
    niceToHave: lines(get("niceToHave")),
    facts: text(get("facts")),
  };
}

export type MandateParse = { ok: true; mandate: Mandate } | { ok: false; fields: MandateField[] };

export function parseMandate(input: unknown): MandateParse {
  const parsed = mandateSchema.safeParse(input);
  if (parsed.success) return { ok: true, mandate: parsed.data };
  const fields = new Set<MandateField>();
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && (MANDATE_FIELDS as readonly string[]).includes(field)) {
      fields.add(field as MandateField);
    }
  }
  return { ok: false, fields: [...fields] };
}
