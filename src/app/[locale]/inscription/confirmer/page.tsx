import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { buttonClass } from "@/components/button";
import { Link } from "@/i18n/navigation";
import { confirmEmail } from "@/lib/auth/accounts";
import { safeCallbackUrl } from "@/lib/auth/redirect";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.confirm");
  // Le jeton est dans l'URL : jamais transmis à une autre page par l'en-tête Referer.
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

type Props = { searchParams: Promise<{ token?: string; callbackUrl?: string }> };

/** Lien de vérification d'adresse (jeton à usage unique, 24 heures). */
export default async function ConfirmEmailPage({ searchParams }: Props) {
  const { token, callbackUrl } = await searchParams;
  const t = await getTranslations("auth.confirm");
  const ok = typeof token === "string" && (await confirmEmail(token));
  const next = safeCallbackUrl(callbackUrl);
  const login = `/connexion?verified=1${next === "/app" ? "" : `&callbackUrl=${encodeURIComponent(next)}`}`;

  return (
    <AuthCard title={ok ? t("successTitle") : t("failedTitle")}>
      <p className="text-ink-muted">{ok ? t("successText") : t("failedText")}</p>
      <Link
        href={ok ? login : "/connexion"}
        className={`${buttonClass("primary", "lg")} mt-7 w-full sm:w-auto`}
      >
        {t("login")}
      </Link>
    </AuthCard>
  );
}
