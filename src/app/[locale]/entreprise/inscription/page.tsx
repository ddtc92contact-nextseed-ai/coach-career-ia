import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
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
 * fois connecté, par mot de passe ou lien magique) création de l'organisation. Un compte
 * déjà membre est renvoyé vers son espace.
 */
export default async function EmployerSignupPage() {
  const [user, locale, t, tSignup] = await Promise.all([
    getCurrentUser(),
    getLocale(),
    getTranslations("employer.signup"),
    getTranslations("auth.signup"),
  ]);
  if (user && (await getMembership(user.id))) redirect({ href: "/entreprise", locale });
  const days = postingDurationDays();

  return (
    <>
      <SiteHeader />
      <main className="band-night text-on-night relative isolate overflow-hidden">
        <div
          aria-hidden="true"
          className="from-signal/12 absolute -top-48 -left-40 -z-10 size-[40rem] rounded-full bg-radial to-transparent to-70%"
        />
        <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:py-24">
          <section className="lg:pt-6">
            <p className="text-signal flex items-center gap-2 text-[0.9375rem] font-semibold tracking-wide uppercase">
              <Icon name="building" className="size-4.5" />
              {t("eyebrow")}
            </p>
            <h1 className="mt-4 text-4xl leading-[1.08] font-bold tracking-tight text-balance hyphens-auto sm:text-5xl">
              {t("title")}
            </h1>
            <p className="text-on-night-muted mt-5 text-lg text-pretty sm:text-xl">{t("intro")}</p>
            <ul className="mt-8 space-y-4">
              {POINTS.map((point) => (
                <li key={point} className="flex gap-4 text-lg">
                  <span className="border-night-line bg-night-raised text-signal grid size-9 shrink-0 place-items-center rounded-lg border">
                    <Icon name="check" className="size-5" strokeWidth={2.25} />
                  </span>
                  <span className="pt-1 text-pretty">{t(`points.${point}`, { days })}</span>
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="org-form-title"
            className="border-line bg-surface text-ink rounded-3xl border p-6 shadow-lg sm:p-9"
          >
            <h2
              id="org-form-title"
              className="text-2xl font-bold tracking-tight text-balance sm:text-3xl"
            >
              {t("formTitle")}
            </h2>
            <p className="text-ink-muted mt-2 mb-7 text-pretty">{t("formIntro")}</p>
            {user ? (
              <>
                <p className="bg-subtle text-ink-muted mb-6 rounded-xl px-4 py-3 text-sm break-all">
                  {t("signedInAs", { email: user.email })}
                </p>
                <OrganizationForm countryNames={countryNames(locale)} />
              </>
            ) : (
              <>
                <Link
                  href="/inscription?callbackUrl=%2Fentreprise%2Finscription"
                  className={`${buttonClass("primary", "lg")} w-full`}
                >
                  {t("cta")}
                  <Icon name="arrow" className="size-4" />
                </Link>
                <p className="text-ink-muted mt-5 text-center">
                  {tSignup("haveAccount")}{" "}
                  <Link
                    href="/connexion?callbackUrl=%2Fentreprise%2Finscription"
                    className="text-brand-ink font-medium underline underline-offset-4"
                  >
                    {tSignup("login")}
                  </Link>
                </p>
              </>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
