import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Icon } from "@/components/icons";
import { ProfileCardView } from "@/components/profile-card";
import { PublicFrame } from "@/components/public-frame";
import { RevealedIdentityView } from "@/components/revealed-identity";
import { revealedCvPath } from "@/lib/handover/config";
import { resolveHandover } from "@/lib/handover/repository";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("revealedPage");
  return {
    title: t("title"),
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

/**
 * Profil révélé, ouvert par le lien à jeton envoyé à l'entreprise (sans
 * connexion) : identité choisie par la personne candidate, carte anonyme et
 * CV si choisi. Jeton inconnu, révoqué ou expiré : 404, sans distinguer.
 */
export default async function RevealedProfilePage({ params }: Props) {
  const { token } = await params;
  const result = await resolveHandover(token, { countView: true });
  if (result.status !== "active") notFound();
  const { profile } = result;
  const [t, format] = await Promise.all([getTranslations("revealedPage"), getFormatter()]);

  return (
    <PublicFrame
      title={t("title")}
      lead={<span className="break-words">{t("context", { title: profile.offerTitle })}</span>}
      notice={`${t("expires", { date: format.dateTime(profile.expiresAt, "short") })} ${t("notice")}`}
    >
      <p className="border-brand-line bg-brand-soft text-brand-ink flex items-start gap-3 rounded-2xl border px-5 py-4">
        <Icon name="unlock" className="mt-0.5 size-5 shrink-0" />
        <span>{t("disclosure")}</span>
      </p>
      <section className="mt-8" aria-labelledby="identite">
        <h2
          id="identite"
          className="font-display mb-4 text-xl font-bold tracking-tight sm:text-2xl"
        >
          {t("identity")}
        </h2>
        <RevealedIdentityView identity={profile.identity} cvHref={revealedCvPath(token)} />
      </section>
      {profile.card ? (
        <section className="mt-10" aria-labelledby="carte">
          <h2 id="carte" className="font-display mb-4 text-xl font-bold tracking-tight sm:text-2xl">
            {t("card")}
          </h2>
          <ProfileCardView card={profile.card} />
        </section>
      ) : null}
    </PublicFrame>
  );
}
