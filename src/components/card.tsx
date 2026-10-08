import type { HTMLAttributes, ReactNode } from "react";

const TONES = {
  default: "bg-surface border-line",
  brand: "band-brand border-brand-line",
  night: "band-night on-night border-night-line text-on-night",
} as const;

type CardTone = keyof typeof TONES;

/**
 * Carte de l'application (docs/brand.md §6) : surface qui se détache du fond
 * teinté. `tone` : `default` (blanc), `brand` (vert doux), `night` (nuit).
 */
export function Card({
  as: Tag = "section",
  tone = "default",
  className = "",
  children,
  ...props
}: {
  as?: "section" | "div" | "article" | "aside";
  tone?: CardTone;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      data-tone={tone}
      className={`rounded-2xl border p-5 shadow-sm sm:p-7 ${TONES[tone]} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Titre de carte (`h2` par défaut, style H2 de la charte), description et actions. */
export function CardHeader({
  title,
  description,
  actions,
  id,
  as: Heading = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <Heading
          id={id}
          className={
            Heading === "h2"
              ? "font-display text-xl font-bold tracking-tight text-balance sm:text-2xl"
              : "text-lg font-semibold text-balance"
          }
        >
          {title}
        </Heading>
        {description ? (
          <p className="text-ink-muted in-data-[tone=night]:text-on-night-muted mt-1.5 max-w-3xl text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
