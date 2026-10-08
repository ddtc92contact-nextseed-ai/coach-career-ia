import type { Metadata } from "next";
import { connection } from "next/server";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { HeroDemo } from "@/components/landing/hero-demo";
import { Pricing } from "@/components/landing/pricing";
import {
  ClosingCta,
  CoachSample,
  Faq,
  ForCompanies,
  HowItWorks,
  PrivacyProof,
  SECTION_IDS,
} from "@/components/landing/sections";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SIGN_UP_PATH } from "@/config/routes";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { jobPostingPriceFromEnv, postingDurationDays } from "@/lib/employer/config";
import { localeAlternates } from "@/lib/i18n/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return hasLocale(routing.locales, locale) ? { alternates: localeAlternates(locale, "/") } : {};
}

const NAV = ["how", "privacy", "coach", "pricing", "faq"] as const;

/**
 * Accueil. Les prix (Premium, publication d'offre) et le quota du coach sont
 * lus dans la configuration à chaque requête, jamais figés au build.
 */
export default async function HomePage() {
  await connection();
  const [t, tc, format] = await Promise.all([
    getTranslations("landing"),
    getTranslations("landing.companies"),
    getFormatter(),
  ]);
  const posting = jobPostingPriceFromEnv();
  const postingPrice = tc("points.price", {
    price: format.number(posting.amountCents / 100, {
      style: "currency",
      currency: posting.currency,
      maximumFractionDigits: posting.amountCents % 100 === 0 ? 0 : 2,
    }),
    days: postingDurationDays(),
  });

  return (
    <>
      <a
        href="#contenu"
        className="bg-primary text-on-primary sr-only z-50 rounded-lg px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("skip")}
      </a>
      <SiteHeader
        sections={NAV.map((key) => ({ href: `#${SECTION_IDS[key]}`, label: t(`nav.${key}`) }))}
      />
      <main id="contenu" className="overflow-x-clip">
        <section aria-labelledby="accueil-titre" className="relative isolate">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_80%_-10%,var(--cc-brand-soft),transparent_70%)]"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-12 pb-20 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pb-28">
            <div>
              <p className="border-line bg-surface text-ink-muted inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium shadow-xs">
                <span aria-hidden="true" className="bg-brand size-2 rounded-full" />
                {t("hero.eyebrow")}
              </p>
              <h1
                id="accueil-titre"
                className="mt-6 text-4xl leading-[1.05] font-bold tracking-tight text-balance hyphens-auto sm:text-5xl lg:text-[3.5rem]"
              >
                {t.rich("hero.title", {
                  signal: (chunks) => (
                    <span className="text-brand-ink relative whitespace-nowrap">
                      {chunks}
                      <span
                        aria-hidden="true"
                        className="bg-brand/30 absolute inset-x-0 -bottom-1 h-1.5 rounded-full"
                      />
                    </span>
                  ),
                })}
              </h1>
              <p className="text-ink-muted mt-6 max-w-xl text-lg text-pretty">{t("hero.intro")}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href={SIGN_UP_PATH} className={buttonClass("primary", "lg")}>
                  {t("hero.ctaPrimary")}
                  <Icon name="arrow" className="size-4" />
                </Link>
                <a href={`#${SECTION_IDS.how}`} className={buttonClass("secondary", "lg")}>
                  {t("hero.ctaSecondary")}
                </a>
              </div>
              <p className="text-ink-subtle mt-5 flex items-start gap-2 text-sm">
                <Icon name="lock" className="mt-px size-4 shrink-0" />
                {t("hero.reassurance")}
              </p>
            </div>
            <HeroDemo />
          </div>
        </section>

        <HowItWorks />
        <PrivacyProof />
        <CoachSample />
        <Pricing />
        <div className="py-20 sm:py-28">
          <ForCompanies priceLine={postingPrice} />
        </div>
        <Faq />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
