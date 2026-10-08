import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { buttonClass } from "@/components/button";
import { VaultResetNotice } from "@/components/auth/vault-reset-notice";
import { Link } from "@/i18n/navigation";
import { peekToken } from "@/lib/auth/tokens";
import { ResetForm } from "./reset-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset");
  // Le jeton est dans l'URL : jamais transmis à une autre page par l'en-tête Referer.
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

type Props = { searchParams: Promise<{ token?: string }> };

/** Lien « mot de passe oublié » : le jeton n'est consommé qu'à l'enregistrement. */
export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams;
  const t = await getTranslations("auth.reset");
  const valid = typeof token === "string" && (await peekToken(token, "RESET_PASSWORD"));

  if (!valid) {
    return (
      <AuthCard title={t("invalidTitle")}>
        <p className="text-ink-muted">{t("invalidText")}</p>
        <Link
          href="/connexion/mot-de-passe-oublie"
          className={`${buttonClass("primary", "lg")} mt-7 w-full sm:w-auto`}
        >
          {t("requestNew")}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("title")}>
      <p className="text-ink-muted mb-5 text-pretty">{t("intro")}</p>
      <div className="mb-6">
        <VaultResetNotice />
      </div>
      <ResetForm token={token} />
    </AuthCard>
  );
}
