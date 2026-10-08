import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ProfileCardView } from "@/components/profile-card";
import { Link } from "@/i18n/navigation";
import { resolveCardLink } from "@/lib/card/repository";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publicCard");
  return {
    title: t("title"),
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

/**
 * Carte anonyme publique, ouverte par un lien à jeton (sans connexion).
 * Jeton inconnu, expiré ou révoqué, ou carte devenue non partageable : 404,
 * sans distinguer les cas.
 */
export default async function PublicCardPage({ params }: Props) {
  const { token } = await params;
  const link = await resolveCardLink(token, { countView: true });
  if (!link) notFound();
  const t = await getTranslations("publicCard");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-8 sm:py-12">
      <div className="mb-8 flex items-center justify-between gap-3">
        <Logo />
        <LocaleSwitcher />
      </div>
      <h1 className="sr-only">{t("title")}</h1>
      <ProfileCardView card={link.card} />
      {link.contactId ? (
        <Link
          href={`/p/${token}/repondre`}
          className="bg-primary text-on-primary hover:bg-primary-hover mt-6 inline-block rounded-lg px-4 py-2.5 text-center text-sm font-medium"
        >
          {t("reply")}
        </Link>
      ) : null}
      <p className="text-ink-subtle mt-6 text-xs">{t("notice")}</p>
    </main>
  );
}
