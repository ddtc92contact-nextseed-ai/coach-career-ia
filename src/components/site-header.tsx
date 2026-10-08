import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/button";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SIGN_UP_PATH } from "@/config/routes";
import { Link } from "@/i18n/navigation";

/** En-tête des pages publiques ; `sections` = ancres de la page (accueil). */
export function SiteHeader({ sections }: { sections?: { href: string; label: string }[] }) {
  const t = useTranslations("header");
  return (
    <header className="bg-canvas/85 border-line sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />
        {sections?.length ? (
          <nav aria-label={t("sections")} className="hidden xl:block">
            <ul className="flex items-center gap-1">
              {sections.map((section) => (
                <li key={section.href}>
                  <a
                    href={section.href}
                    className={`${buttonClass("ghost", "sm")} whitespace-nowrap`}
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <nav aria-label={t("mainNav")} className="flex min-w-0 items-center gap-2">
          <LocaleSwitcher />
          {sections?.length ? null : (
            <Link
              href="/entreprise/inscription"
              className={`${buttonClass("ghost", "sm")} whitespace-nowrap max-md:hidden`}
            >
              {t("recruiter")}
            </Link>
          )}
          <Link
            href="/connexion"
            className={`${buttonClass("secondary", "sm")} whitespace-nowrap max-sm:border-transparent max-sm:bg-transparent max-sm:shadow-none`}
          >
            {t("signIn")}
          </Link>
          <Link
            href={SIGN_UP_PATH}
            className={`${buttonClass("primary", "sm")} whitespace-nowrap max-sm:hidden`}
          >
            {t("createAgent")}
          </Link>
        </nav>
      </div>
    </header>
  );
}
