import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Logo } from "@/components/logo";
import { ProfileCardView } from "@/components/profile-card";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-8 sm:py-12">
      <div className="mb-8 flex items-center justify-between gap-3">
        <Logo />
        <LocaleSwitcher />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-ink-muted mt-1 text-sm break-words">
        {t("context", { title: profile.offerTitle })}
      </p>
      <p className="bg-brand-soft text-brand-ink mt-4 rounded-lg px-3 py-2 text-sm">
        {t("disclosure")}
      </p>
      <section className="mt-6" aria-labelledby="identite">
        <h2 id="identite" className="mb-3 text-lg font-semibold">
          {t("identity")}
        </h2>
        <RevealedIdentityView identity={profile.identity} cvHref={revealedCvPath(token)} />
      </section>
      {profile.card ? (
        <section className="mt-8" aria-labelledby="carte">
          <h2 id="carte" className="mb-3 text-lg font-semibold">
            {t("card")}
          </h2>
          <ProfileCardView card={profile.card} />
        </section>
      ) : null}
      <p className="text-ink-subtle mt-6 text-xs">
        {t("expires", { date: format.dateTime(profile.expiresAt, "short") })} {t("notice")}
      </p>
    </main>
  );
}
