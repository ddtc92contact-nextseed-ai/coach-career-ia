import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/button";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SectionNav, SiteMenu, type SectionLink } from "@/components/site-nav";
import { SIGN_UP_PATH } from "@/config/routes";
import { Link } from "@/i18n/navigation";

/**
 * En-tête des pages publiques ; `sections` = ancres de la page (accueil),
 * affichées dès 1024 px avec la section lue mise en avant. En dessous, un
 * bouton ouvre le menu plein écran (`SiteMenu`).
 */
export function SiteHeader({ sections }: { sections?: SectionLink[] }) {
  const t = useTranslations("header");
  const withSections = Boolean(sections?.length);
  return (
    <header className="bg-surface/90 border-line sticky top-0 z-40 border-b shadow-xs backdrop-blur-md">
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 xl:gap-4 xl:px-8">
        <Logo compactUntil={withSections ? "xl" : "sm"} />
        {sections?.length ? <SectionNav sections={sections} label={t("sections")} /> : null}
        <div className="flex min-w-0 items-center gap-2 lg:gap-3">
          <div className="max-sm:hidden">
            <LocaleSwitcher />
          </div>
          {withSections ? null : (
            <Link
              href="/entreprise/inscription"
              className={`${buttonClass("ghost")} whitespace-nowrap max-lg:hidden`}
            >
              {t("recruiter")}
            </Link>
          )}
          <Link
            href="/connexion"
            className={`${buttonClass("secondary")} whitespace-nowrap max-lg:hidden`}
          >
            {t("signIn")}
          </Link>
          <Link
            href={SIGN_UP_PATH}
            className={`${buttonClass("primary")} whitespace-nowrap max-sm:hidden`}
          >
            {t("createAgent")}
          </Link>
          <SiteMenu sections={sections} />
        </div>
      </div>
    </header>
  );
}
