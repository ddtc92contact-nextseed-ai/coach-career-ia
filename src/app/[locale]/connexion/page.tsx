import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { Icon } from "@/components/icons";
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
    <AuthCard
      title={t("title")}
      panel={callbackUrl.startsWith("/entreprise") ? "company" : "candidate"}
    >
      {notice ? (
        <p
          role="status"
          className="border-brand-line bg-brand-soft text-brand-ink mb-5 rounded-xl border px-4 py-3"
        >
          {notice}
        </p>
      ) : null}
      <p className="text-ink-muted mb-7 text-pretty">{t("intro")}</p>
      <PasswordLoginForm callbackUrl={callbackUrl} />
      <p className="text-ink-muted mt-6 text-center">
        {tPassword("noAccount")}{" "}
        <Link
          href={withCallback("/inscription")}
          className="text-brand-ink font-medium underline underline-offset-4"
        >
          {tPassword("signup")}
        </Link>
      </p>
      <details className="group border-line bg-subtle mt-8 rounded-2xl border">
        <summary className="text-ink hover:bg-muted flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-3">
            <Icon name="send" className="text-brand-ink size-5 shrink-0" />
            {t("magicToggle")}
          </span>
          <Icon
            name="chevron"
            className="text-ink-subtle size-5 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
          />
        </summary>
        <div className="px-5 pb-5">
          <p className="text-ink-muted mb-4 text-base text-pretty">{t("magicIntro")}</p>
          <LoginForm callbackUrl={callbackUrl} />
        </div>
      </details>
      <div className="mt-6">
        <LegalConsent audience="candidate" />
      </div>
      <p className="mt-6 text-center text-base">
        <Link href="/" className="text-ink-muted underline-offset-4 hover:underline">
          {t("backHome")}
        </Link>
      </p>
    </AuthCard>
  );
}
