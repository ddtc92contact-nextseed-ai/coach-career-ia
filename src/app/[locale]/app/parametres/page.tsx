import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { accountKdf } from "@/lib/auth/accounts";
import { requireUser } from "@/lib/auth/session";
import { getAlertSettings } from "@/lib/matching/repository";
import { AlertsForm } from "./alerts-form";
import { DeleteAccountForm } from "./delete-account-form";
import { PasswordForm } from "./password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";

export default async function SettingsPage() {
  const user = await requireUser();
  const [t, alerts, kdf] = await Promise.all([
    getTranslations("settings"),
    getAlertSettings(user.id),
    accountKdf(user.id),
  ]);
  const hasPassword = kdf !== null;
  return (
    <div className="max-w-3xl space-y-6">
      <PageTitle title={t("title")} intro={t("intro")} />

      <section
        id="mot-de-passe"
        className={`${sectionClass} scroll-mt-6`}
        aria-labelledby="mot-de-passe-titre"
      >
        <h2 id="mot-de-passe-titre" className="text-lg font-semibold">
          {t("password.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">
          {hasPassword ? t("password.introChange") : t("password.introSet")}
        </p>
        <PasswordForm hasPassword={hasPassword} email={user.email} />
      </section>

      <section className={sectionClass} aria-labelledby="langue">
        <h2 id="langue" className="text-lg font-semibold">
          {t("language.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">{t("language.intro")}</p>
        <LocaleSwitcher persist showLabel />
      </section>

      <section
        id="alertes"
        className={`${sectionClass} scroll-mt-6`}
        aria-labelledby="alertes-titre"
      >
        <h2 id="alertes-titre" className="text-lg font-semibold">
          {t("alerts.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">{t("alerts.intro")}</p>
        <AlertsForm frequency={alerts.frequency} minScore={alerts.minScore} />
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
