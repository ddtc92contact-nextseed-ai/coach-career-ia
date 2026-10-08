import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

const TONES = {
  neutral: "bg-muted text-ink-muted ring-line",
  proven: "bg-brand-soft text-brand-ink ring-brand-line",
  warning: "bg-warning-soft text-warning-ink ring-warning-line",
  danger: "bg-danger-soft text-danger-ink ring-danger-line",
  /** Pastille pleine « feu vert » (réponse reçue, nouveauté). */
  brand: "bg-brand text-on-brand ring-brand",
  /** Ce qui se passe « dans l'ombre » : identité révélée, mode de l'agent. */
  night: "bg-night text-on-night ring-night-line",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: BadgeTone;
  /** Icône décorative devant le libellé (le sens reste porté par le texte). */
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}
    >
      {icon ? <Icon name={icon} className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}
