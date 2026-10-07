import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { requireUser } from "@/lib/auth/session";
import { DeleteAccountForm } from "./delete-account-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";

export default async function SettingsPage() {
  await requireUser();
  const t = await getTranslations("settings");
  return (
    <div className="max-w-3xl space-y-6">
      <PageTitle title={t("title")} intro={t("intro")} />

      <section className={sectionClass} aria-labelledby="langue">
        <h2 id="langue" className="text-lg font-semibold">
          {t("language.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">{t("language.intro")}</p>
        <LocaleSwitcher persist showLabel />
      </section>

      <section className={sectionClass} aria-labelledby="export">
        <h2 id="export" className="text-lg font-semibold">
          {t("export.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">{t("export.intro")}</p>
        <a
          href="/api/account/export"
          download
          className="inline-block rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium hover:bg-stone-100"
        >
          {t("export.button")}
        </a>
      </section>

      <section className={`${sectionClass} border-red-200`} aria-labelledby="suppression">
        <h2 id="suppression" className="text-lg font-semibold text-red-800">
          {t("delete.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">{t("delete.intro")}</p>
        <DeleteAccountForm />
      </section>
    </div>
  );
}
