import type { ReactNode } from "react";

/** Bandeaux de couleur (utilitaires `band-*` de globals.css). */
const BANDS = {
  brand: "band-brand border-brand-line text-ink",
  night: "band-night on-night border-night-line text-on-night",
} as const;

/**
 * En-tête de page de l'application (docs/brand.md §6) : titre `h1`, chapô,
 * actions et, en option, un bandeau de couleur pour que la page ne soit pas
 * du blanc sur blanc. Un seul par page.
 */
export function PageHeader({
  title,
  lead,
  eyebrow,
  actions,
  band,
  children,
}: {
  title: string;
  lead?: ReactNode;
  /** Surtitre court au-dessus du titre. */
  eyebrow?: string;
  actions?: ReactNode;
  band?: keyof typeof BANDS;
  /** Contenu complémentaire sous le titre (indicateurs, filtres…). */
  children?: ReactNode;
}) {
  const night = band === "night";
  return (
    <header
      className={`mb-8 lg:mb-10 ${
        band ? `rounded-3xl border px-5 py-7 shadow-sm sm:px-8 sm:py-9 lg:px-10 ${BANDS[band]}` : ""
      }`}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p
              className={`mb-2 text-sm font-semibold tracking-wide uppercase ${
                night ? "text-signal" : "text-brand-ink"
              }`}
            >
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-3xl font-bold tracking-tight text-balance hyphens-auto sm:text-4xl">
            {title}
          </h1>
          {lead ? (
            <p
              className={`mt-3 max-w-3xl text-base text-pretty sm:text-lg ${
                night ? "text-on-night-muted" : "text-ink-muted"
              }`}
            >
              {lead}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>
        ) : null}
      </div>
      {children}
    </header>
  );
}
