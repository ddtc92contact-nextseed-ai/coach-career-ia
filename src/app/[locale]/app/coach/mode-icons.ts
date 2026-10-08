import type { IconName } from "@/components/icons";
import type { CoachModeCode } from "@/lib/coach/shared";

/** Pictogramme de chaque mode du coach (cartes de départ, historique, en-tête). */
export const MODE_ICONS: Record<CoachModeCode, IconName> = {
  DISCOVER: "memory",
  CLARIFY: "shield",
  INTERVIEW: "chat",
};
