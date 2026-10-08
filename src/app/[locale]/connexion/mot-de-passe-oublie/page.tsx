import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { VaultResetNotice } from "@/components/auth/vault-reset-notice";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { localeAlternates } from "@/lib/i18n/metadata";
import { ForgotForm } from "./forgot-form";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "auth.forgot" });
  return {
    title: t("metaTitle"),
    alternates: localeAlternates(locale, "/connexion/mot-de-passe-oublie"),
  };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgot");
  return (
    <AuthCard title={t("title")}>
      <p className="text-ink-muted mb-5 text-pretty">{t("intro")}</p>
      <div className="mb-6">
        <VaultResetNotice />
      </div>
      <ForgotForm />
      <p className="mt-6 text-center">
        <Link href="/connexion" className="text-ink-muted underline-offset-4 hover:underline">
          {t("back")}
        </Link>
      </p>
    </AuthCard>
  );
}
