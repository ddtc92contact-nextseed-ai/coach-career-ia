import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";

export function SiteHeader() {
  const t = useTranslations("header");
  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />
        <nav aria-label={t("mainNav")} className="flex items-center gap-2 sm:gap-3">
          <LocaleSwitcher />
          <Link
            href="/entreprise/inscription"
            className="rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap text-stone-700 hover:bg-stone-100 sm:px-3"
          >
            {t("recruiter")}
          </Link>
          <Link
            href="/connexion"
            className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium whitespace-nowrap text-white hover:bg-stone-700 sm:px-4"
          >
            {t("signIn")}
          </Link>
        </nav>
      </div>
    </header>
  );
}
