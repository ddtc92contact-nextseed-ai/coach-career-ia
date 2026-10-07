import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth-card";
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
    <Link href="/app/parametres#alertes" className="text-brand-700 underline underline-offset-4">
      {tn("settings")}
    </Link>
  );

  if (first(params.termine)) {
    return (
      <AuthCard title={t("doneTitle")}>
        <p role="status" className="text-stone-600">
          {t("doneText")}
        </p>
        <p className="mt-4 text-sm">{settings}</p>
      </AuthCard>
    );
  }
  if (first(params.invalide) || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return (
      <AuthCard title={t("invalidTitle")}>
        <p className="text-stone-600">{t("invalidText")}</p>
        <p className="mt-4 text-sm">{settings}</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("title")}>
      <p className="text-stone-600">{t("confirmText")}</p>
      <form action={confirmUnsubscribe.bind(null, token)} className="mt-6">
        <button
          type="submit"
          className="w-full rounded-lg bg-stone-900 px-5 py-2.5 font-medium text-white hover:bg-stone-700"
        >
          {t("button")}
        </button>
      </form>
    </AuthCard>
  );
}
