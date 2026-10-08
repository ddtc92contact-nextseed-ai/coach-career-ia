import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/logo";
import { Link } from "@/i18n/navigation";
import { legalPath } from "@/lib/legal/pages";

/** Liens légaux du pied de page (accueil, espace candidat, espace entreprise). */
const LEGAL_LINKS = [
  { key: "notice", href: legalPath("notice") },
  { key: "privacy", href: legalPath("privacy") },
  { key: "cookies", href: legalPath("privacy", "cookies") },
  { key: "terms", href: legalPath("terms") },
  { key: "companyTerms", href: legalPath("companyTerms") },
  { key: "ai", href: legalPath("ai") },
] as const;

export function SiteFooter() {
  const t = useTranslations("footer");
  const tl = useTranslations("legal.nav");
  const tm = useTranslations("metadata");
  return (
    <footer className="border-line bg-surface border-t">
      <div className="text-ink-subtle mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-3">
          <p className="font-display text-ink flex items-center gap-2.5 text-base font-bold tracking-tight">
            <BrandMark className="size-7" />
            {tm("siteName")}
          </p>
          <p className="max-w-xs text-pretty">{t("tagline")}</p>
        </div>
        <nav aria-label={tl("label")}>
          <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            {LEGAL_LINKS.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  className="hover:text-ink rounded-sm hover:underline hover:underline-offset-4"
                >
                  {tl(link.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-line flex flex-col gap-2 border-t pt-6 sm:flex-row sm:justify-between md:col-span-2">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
          <p className="text-pretty sm:text-right">{t("privacy")}</p>
        </div>
      </div>
    </footer>
  );
}
