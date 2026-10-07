import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth/session";
import { safeCallbackUrl } from "@/lib/auth/redirect";
import { localeAlternates } from "@/lib/i18n/metadata";
import { LoginForm } from "./login-form";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "auth.login" });
  return { title: t("metaTitle"), alternates: localeAlternates(locale, "/connexion") };
}

export default async function LoginPage({ params, searchParams }: Props) {
  const [{ locale }, user] = await Promise.all([params, getCurrentUser()]);
  const { callbackUrl: rawCallbackUrl } = await searchParams;
  const callbackUrl = safeCallbackUrl(rawCallbackUrl);
  if (user && hasLocale(routing.locales, locale)) redirect({ href: callbackUrl, locale });
  const t = await getTranslations("auth.login");

  return (
    <AuthCard title={t("title")}>
      <p className="mb-6 text-sm text-stone-600">{t("intro")}</p>
      <LoginForm callbackUrl={callbackUrl} />
      <p className="mt-6 text-center text-sm">
        <Link href="/" className="text-stone-500 underline-offset-4 hover:underline">
          {t("backHome")}
        </Link>
      </p>
    </AuthCard>
  );
}
