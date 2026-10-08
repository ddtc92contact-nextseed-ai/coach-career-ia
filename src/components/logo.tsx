import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Symbole de la marque (docs/brand.md) : un croissant d'ombre (l'agent qui
 * travaille dans l'ombre) et le point « feu vert » (vous décidez quand y aller).
 * Même dessin que `src/app/icon.svg`.
 */
export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8.5"
        className="fill-night stroke-night-line"
      />
      <path d="M15 7a9 9 0 0 0 0 18 11 11 0 0 1 0-18Z" className="fill-on-night" />
      <circle cx="21.5" cy="16" r="3.25" className="fill-signal" />
    </svg>
  );
}

/** Logo : symbole + nom du produit (le nom passe en texte masqué sur mobile). */
export function Logo({ href = "/" }: { href?: string }) {
  const t = useTranslations("metadata");
  return (
    <Link
      href={href}
      className="font-display text-ink flex shrink-0 items-center gap-2.5 rounded-lg text-[1.0625rem] font-bold tracking-tight"
    >
      <BrandMark />
      <span className="truncate max-sm:sr-only">{t("siteName")}</span>
    </Link>
  );
}
