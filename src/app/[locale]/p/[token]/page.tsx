import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { ProfileCardView } from "@/components/profile-card";
import { PublicFrame } from "@/components/public-frame";
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
    <PublicFrame title={t("title")} titleHidden notice={t("notice")}>
      <ProfileCardView card={link.card} />
      {link.contactId ? (
        <Link
          href={`/p/${token}/repondre`}
          className={`${buttonClass("primary", "lg")} mt-8 max-sm:w-full`}
        >
          <Icon name="chat" className="size-5" />
          {t("reply")}
        </Link>
      ) : null}
    </PublicFrame>
  );
}
