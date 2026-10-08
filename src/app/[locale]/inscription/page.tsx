import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { safeCallbackUrl } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/session";
import { localeAlternates } from "@/lib/i18n/metadata";
import { SignupForm } from "./signup-form";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "auth.signup" });
  return { title: t("metaTitle"), alternates: localeAlternates(locale, "/inscription") };
}

export default async function SignupPage({ params, searchParams }: Props) {
  const [{ locale }, user] = await Promise.all([params, getCurrentUser()]);
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  if (user && hasLocale(routing.locales, locale)) redirect({ href: callbackUrl, locale });
  const t = await getTranslations("auth.signup");
  const loginHref =
    callbackUrl === "/app"
      ? "/connexion"
      : `/connexion?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <AuthCard title={t("title")}>
      <p className="text-ink-muted mb-6 text-sm">{t("intro")}</p>
      <SignupForm callbackUrl={callbackUrl} />
      <p className="text-ink-muted mt-6 text-center text-sm">
        {t("haveAccount")}{" "}
        <Link href={loginHref} className="text-brand-ink font-medium underline underline-offset-4">
          {t("login")}
        </Link>
      </p>
    </AuthCard>
  );
}
