import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth/session";
import { postingDurationDays } from "@/lib/employer/config";
import { countryNames } from "@/lib/employer/countries";
import { getMembership } from "@/lib/employer/repository";
import { localeAlternates } from "@/lib/i18n/metadata";
import { OrganizationForm } from "./org-form";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "employer.signup" });
  return {
    title: t("metaTitle"),
    alternates: localeAlternates(locale, "/entreprise/inscription"),
  };
}

const POINTS = ["salary", "pay", "privacy"] as const;

/**
 * « Je recrute » : présentation publique de l'espace entreprise, puis (une
 * fois connecté par lien magique) création de l'organisation. Un compte
 * déjà membre est renvoyé vers son espace.
 */
export default async function EmployerSignupPage() {
  const [user, locale, t] = await Promise.all([
    getCurrentUser(),
    getLocale(),
    getTranslations("employer.signup"),
  ]);
  if (user && (await getMembership(user.id))) redirect({ href: "/entreprise", locale });
  const days = postingDurationDays();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2">
        <section>
          <p className="text-brand-ink text-sm font-medium tracking-wide uppercase">
            {t("eyebrow")}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t("title")}
          </h1>
          <p className="text-ink-muted mt-4 text-pretty">{t("intro")}</p>
          <ul className="mt-6 space-y-3">
            {POINTS.map((point) => (
              <li key={point} className="text-ink-muted flex gap-3">
                <span aria-hidden="true" className="text-brand-ink mt-0.5 font-semibold">
                  ✓
                </span>
                <span>{t(`points.${point}`, { days })}</span>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="org-form-title"
          className="border-line bg-surface rounded-2xl border p-5 sm:p-8"
        >
          <h2 id="org-form-title" className="text-lg font-semibold">
            {t("formTitle")}
          </h2>
          <p className="text-ink-muted mt-2 mb-6 text-sm">{t("formIntro")}</p>
          {user ? (
            <>
              <p className="text-ink-subtle mb-5 text-sm break-all">
                {t("signedInAs", { email: user.email })}
              </p>
              <OrganizationForm countryNames={countryNames(locale)} />
            </>
          ) : (
            <Link
              href="/connexion?callbackUrl=%2Fentreprise%2Finscription"
              className="bg-primary text-on-primary hover:bg-primary-hover block rounded-lg px-5 py-3 text-center font-medium"
            >
              {t("cta")}
            </Link>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
