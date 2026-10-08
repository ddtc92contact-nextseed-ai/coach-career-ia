import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import type { EvidenceLevelCode } from "@/lib/career/codes";

const TONES: Record<EvidenceLevelCode, string> = {
  DECLARED: "bg-warning-soft text-warning-ink ring-warning-line",
  DOCUMENT: "bg-brand-soft text-brand-ink ring-brand-line",
  VERIFIED: "bg-brand text-on-brand ring-brand",
};

/**
 * Niveau de preuve d'une réalisation (docs/brand.md §6) : « Déclarée »
 * (ambre), « Prouvée » (vert doux), « Vérifiée » (vert plein). L'icône
 * double la couleur : le niveau reste lisible sans elle.
 */
export function EvidenceBadge({ level }: { level: EvidenceLevelCode }) {
  const t = useTranslations("codes.evidence");
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${TONES[level]}`}
    >
      <Icon name={level === "DECLARED" ? "clock" : "check"} className="size-3.5" />
      {t(level)}
    </span>
  );
}
