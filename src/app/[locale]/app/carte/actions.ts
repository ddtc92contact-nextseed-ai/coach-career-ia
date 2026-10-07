"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { requireUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/career/repository";
import {
  approveCard,
  createCardLink,
  getCardState,
  regenerateCard,
  revokeCardLink,
  saveCard,
} from "@/lib/card/repository";
import type { ReidentificationIssue } from "@/lib/card/reidentify";
import type { CardContent } from "@/lib/card/schema";
import { cardPath } from "@/lib/card/tokens";

export type CardFormState = {
  ok?: boolean;
  message?: "saved" | "approved" | "invalid" | "notShareable";
  issues?: ReidentificationIssue[];
  /** Chemin du lien tout juste créé (affiché une seule fois). */
  linkPath?: string;
};

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const checked = (formData: FormData, name: string) => formData.get(name) === "on";

/** Carte modifiée = carte actuelle + champs du formulaire (sans ajout de contenu nouveau). */
function applyForm(card: CardContent, formData: FormData): CardContent {
  return {
    ...card,
    headline: text(formData, "headline"),
    achievements: card.achievements
      .map((a, i) => ({
        include: checked(formData, `achievement-${i}-include`),
        value: {
          ...a,
          title: text(formData, `achievement-${i}-title`),
          result: text(formData, `achievement-${i}-result`),
        },
      }))
      .filter((a) => a.include)
      .map((a) => a.value),
    skills: card.skills.filter((_, i) => checked(formData, `skill-${i}-include`)),
    showSalary: checked(formData, "showSalary"),
    showLocations: checked(formData, "showLocations"),
    allowProofUrls: checked(formData, "allowProofUrls"),
  };
}

export async function saveCardAction(
  _prev: CardFormState,
  formData: FormData,
): Promise<CardFormState> {
  const user = await requireUser();
  const { card } = await getCardState(user.id);
  const result = await saveCard(user.id, applyForm(card, formData));
  revalidatePath("/[locale]/app/carte", "page");
  if (!result.ok) return { message: "invalid" };
  return { ok: true, message: "saved", issues: result.issues };
}

export async function approveCardAction(): Promise<CardFormState> {
  const user = await requireUser();
  const state = await getCardState(user.id);
  // Carte encore jamais enregistrée : la proposition affichée est enregistrée puis validée.
  if (state.generated) await saveCard(user.id, state.card);
  const result = await approveCard(user.id);
  revalidatePath("/[locale]/app", "layout");
  if (!result.ok) return { issues: result.issues };
  return { ok: true, message: "approved" };
}

export async function regenerateCardAction() {
  const user = await requireUser();
  await regenerateCard(user.id);
  revalidatePath("/[locale]/app/carte", "page");
}

export async function createLinkAction(): Promise<CardFormState> {
  const user = await requireUser();
  const result = await createCardLink(user.id);
  revalidatePath("/[locale]/app/carte", "page");
  if (!result.ok) return { message: "notShareable", issues: result.issues };
  return { ok: true, linkPath: cardPath(await getLocale(), result.link.token) };
}

export async function revokeLinkAction(id: string) {
  const user = await requireUser();
  try {
    await revokeCardLink(user.id, id);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  revalidatePath("/[locale]/app", "layout");
}
