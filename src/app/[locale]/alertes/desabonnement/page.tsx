import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
import { buttonClass } from "@/components/button";
import { Link } from "@/i18n/navigation";
import { confirmUnsubscribe } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("unsubscribe");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Désabonnement des alertes. L'ouverture du lien ne désabonne pas (les
 * antivirus de messagerie suivent les liens) : il faut confirmer. Le client
 * de messagerie peut aussi désabonner en un clic (`/api/alerts/unsubscribe`).
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  const [t, tn, params] = await Promise.all([
    getTranslations("unsubscribe"),
    getTranslations("app.nav"),
    searchParams,
  ]);
  const token = first(params.token)?.trim() ?? "";
  const settings = (
    <Link
      href="/app/parametres#alertes"
      className="text-brand-ink font-medium underline underline-offset-4"
    >
      {tn("settings")}
    </Link>
  );

  if (first(params.termine)) {
    return (
      <AuthCard title={t("doneTitle")} panel={false}>
        <p role="status" className="text-ink-muted">
          {t("doneText")}
        </p>
        <p className="mt-5">{settings}</p>
      </AuthCard>
    );
  }
  if (first(params.invalide) || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return (
      <AuthCard title={t("invalidTitle")} panel={false}>
        <p className="text-ink-muted">{t("invalidText")}</p>
        <p className="mt-5">{settings}</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("title")} panel={false}>
      <p className="text-ink-muted">{t("confirmText")}</p>
      <form action={confirmUnsubscribe.bind(null, token)} className="mt-6">
        <button type="submit" className={`${buttonClass("primary", "lg")} w-full`}>
          {t("button")}
        </button>
      </form>
    </AuthCard>
  );
}
