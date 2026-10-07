import { useTranslations } from "next-intl";

export function SiteFooter() {
  const t = useTranslations("footer");
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-stone-500 sm:flex-row sm:justify-between sm:px-6">
        <p>{t("copyright", { year: new Date().getFullYear() })}</p>
        <p>{t("privacy")}</p>
      </div>
    </footer>
  );
}
