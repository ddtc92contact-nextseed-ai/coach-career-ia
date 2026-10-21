import { z } from "zod";

/** Saisie « Ajouter une entreprise » : URL de page carrières ou nom. */
export const followQueryInput = z.string().trim().min(2, "tooShort").max(500, "tooLong");

/** Identifiant d'entreprise (`Company.id`, cuid) envoyé par un bouton. */
export const companyIdInput = z.string().trim().min(1).max(64);
