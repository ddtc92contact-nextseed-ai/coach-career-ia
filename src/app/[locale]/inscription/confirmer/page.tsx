import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
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
      <p className="text-stone-600">{ok ? t("successText") : t("failedText")}</p>
      <Link
        href={ok ? login : "/connexion"}
        className="mt-6 inline-block rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white hover:bg-stone-700"
      >
        {t("login")}
      </Link>
    </AuthCard>
  );
}
