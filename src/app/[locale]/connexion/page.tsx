import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { LegalConsent } from "@/components/legal-consent";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth/session";
import { safeCallbackUrl } from "@/lib/auth/redirect";
import { localeAlternates } from "@/lib/i18n/metadata";
import { LoginForm } from "./login-form";
import { PasswordLoginForm } from "./password-form";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string; verified?: string; reset?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "auth.login" });
  return { title: t("metaTitle"), alternates: localeAlternates(locale, "/connexion") };
}

/**
 * Connexion : e-mail + mot de passe en premier, lien magique en option
 * secondaire (« recevoir plutôt un lien »).
 */
export default async function LoginPage({ params, searchParams }: Props) {
  const [{ locale }, user] = await Promise.all([params, getCurrentUser()]);
  const { callbackUrl: rawCallbackUrl, verified, reset } = await searchParams;
  const callbackUrl = safeCallbackUrl(rawCallbackUrl);
  if (user && hasLocale(routing.locales, locale)) redirect({ href: callbackUrl, locale });
  const [t, tPassword] = await Promise.all([
    getTranslations("auth.login"),
    getTranslations("auth.passwordLogin"),
  ]);
  const notice = verified ? tPassword("verified") : reset ? tPassword("passwordReset") : null;
  const withCallback = (path: string) =>
    callbackUrl === "/app" ? path : `${path}?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <AuthCard title={t("title")}>
      {notice ? (
        <p
          role="status"
          className="border-brand-100 bg-brand-50 text-brand-800 mb-4 rounded-lg border px-4 py-3 text-sm"
        >
          {notice}
        </p>
      ) : null}
      <p className="mb-6 text-sm text-stone-600">{t("intro")}</p>
      <PasswordLoginForm callbackUrl={callbackUrl} />
      <p className="mt-4 text-center text-sm text-stone-600">
        {tPassword("noAccount")}{" "}
        <Link
          href={withCallback("/inscription")}
          className="text-brand-700 font-medium underline underline-offset-4"
        >
          {tPassword("signup")}
        </Link>
      </p>
      <details className="group mt-6 rounded-xl border border-stone-200 p-4">
        <summary className="cursor-pointer text-sm font-medium text-stone-700">
          {t("magicToggle")}
        </summary>
        <p className="mt-3 mb-4 text-sm text-stone-600">{t("magicIntro")}</p>
        <LoginForm callbackUrl={callbackUrl} />
      </details>
      <div className="mt-6">
        <LegalConsent audience="candidate" />
      </div>
      <p className="mt-6 text-center text-sm">
        <Link href="/" className="text-stone-500 underline-offset-4 hover:underline">
          {t("backHome")}
        </Link>
      </p>
    </AuthCard>
  );
}
