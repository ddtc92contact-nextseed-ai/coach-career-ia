import { useTranslations } from "next-intl";
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
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 text-sm text-stone-500 sm:px-6">
        <nav aria-label={tl("label")}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <li key={link.key}>
                <Link href={link.href} className="hover:text-stone-900 hover:underline">
                  {tl(link.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
          <p>{t("privacy")}</p>
        </div>
      </div>
    </footer>
  );
}
