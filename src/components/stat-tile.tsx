import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

const TONES = {
  /** Sur une carte blanche ou le fond de page. */
  default: {
    box: "border-line bg-surface",
    icon: "bg-brand-soft text-brand-ink",
    value: "text-ink",
    label: "text-ink-muted",
  },
  /** Dans un bandeau `band-brand`. */
  brand: {
    box: "border-brand-line bg-surface/80",
    icon: "bg-brand-soft text-brand-ink",
    value: "text-ink",
    label: "text-ink-muted",
  },
  /** Dans un bandeau ou une carte nuit. */
  night: {
    box: "border-night-line bg-night-raised/70",
    icon: "bg-signal/15 text-signal",
    value: "text-on-night",
    label: "text-on-night-muted",
  },
} as const;

/**
 * Chiffre clé (docs/brand.md §6) : icône, valeur en Bricolage Grotesque et
 * libellé (lu juste après la valeur par les lecteurs d'écran). Montre le
 * produit plutôt qu'un paragraphe.
 */
export function StatTile({
  icon,
  value,
  label,
  tone = "default",
}: {
  icon: IconName;
  value: ReactNode;
  label: string;
  tone?: keyof typeof TONES;
}) {
  const style = TONES[tone];
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${style.box}`}>
      <span
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${style.icon}`}
      >
        <Icon name={icon} className="size-5" />
      </span>
      <div className="min-w-0">
        <p
          className={`font-display text-2xl leading-tight font-bold break-words tabular-nums ${style.value}`}
        >
          {value}
        </p>
        <p className={`text-sm hyphens-auto ${style.label}`}>{label}</p>
      </div>
    </div>
  );
}
