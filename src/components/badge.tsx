import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

const TONES = {
  neutral: "bg-muted text-ink-muted ring-line",
  proven: "bg-brand-soft text-brand-ink ring-brand-line",
  warning: "bg-warning-soft text-warning-ink ring-warning-line",
  info: "bg-info-soft text-info-ink ring-info-line",
  danger: "bg-danger-soft text-danger-ink ring-danger-line",
  /** Pastille pleine « feu vert » (réponse reçue, nouveauté). */
  brand: "bg-brand text-on-brand ring-brand",
  /** Ce qui se passe « dans l'ombre » : identité révélée, mode de l'agent. */
  night: "bg-night text-on-night ring-night-line",
} as const;

/** Couleur de la pastille (`dot`) : la teinte pleine du ton. */
const DOTS = {
  neutral: "bg-ink-subtle",
  proven: "bg-brand",
  warning: "bg-warning",
  info: "bg-info-ink",
  danger: "bg-danger",
  brand: "bg-on-brand",
  night: "bg-signal",
} as const;

const SIZES = {
  sm: "gap-1.5 px-2 py-0.5 text-xs",
  md: "gap-2 px-2.5 py-1 text-sm",
} as const;

export type BadgeTone = keyof typeof TONES;

/**
 * Pastille de statut. `dot` ajoute un point de couleur devant le libellé, `icon`
 * une icône décorative (les statuts restent lisibles sans la couleur : le
 * libellé dit tout).
 */
export function Badge({
  tone = "neutral",
  dot = false,
  icon,
  size = "sm",
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  icon?: IconName;
  size?: keyof typeof SIZES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium whitespace-nowrap ring-1 ring-inset ${SIZES[size]} ${TONES[tone]}`}
    >
      {dot ? (
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOTS[tone]}`} />
      ) : null}
      {icon ? <Icon name={icon} className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}
