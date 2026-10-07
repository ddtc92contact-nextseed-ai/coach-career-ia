import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { localeAlternates } from "@/lib/i18n/metadata";

const PILLARS = ["anonymous", "proofs", "guardRails", "control"] as const;
const STEPS = ["one", "two", "three", "four"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return hasLocale(routing.locales, locale) ? { alternates: localeAlternates(locale, "/") } : {};
}

export default function HomePage() {
  const t = useTranslations("landing");

  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
          <p className="text-brand-700 text-sm font-medium tracking-wide uppercase">
            {t("eyebrow")}
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-pretty text-stone-600">{t("intro")}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/connexion"
              className="rounded-lg bg-stone-900 px-5 py-3 text-center font-medium text-white hover:bg-stone-700"
            >
              {t("ctaPrimary")}
            </Link>
            <a
              href="#principes"
              className="rounded-lg border border-stone-300 bg-white px-5 py-3 text-center font-medium hover:bg-stone-100"
            >
              {t("ctaSecondary")}
            </a>
          </div>
        </section>

        <section
          id="principes"
          aria-labelledby="principes-titre"
          className="border-y border-stone-200 bg-white"
        >
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="principes-titre" className="text-2xl font-semibold tracking-tight">
              {t("pillarsTitle")}
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              {PILLARS.map((pillar, index) => (
                <article
                  key={pillar}
                  className="rounded-xl border border-stone-200 bg-stone-50 p-6"
                >
                  <p className="text-brand-700 text-sm font-medium">0{index + 1}</p>
                  <h3 className="mt-2 text-lg font-semibold">{t(`pillars.${pillar}.title`)}</h3>
                  <p className="mt-2 text-stone-600">{t(`pillars.${pillar}.text`)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="etapes-titre" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="etapes-titre" className="text-2xl font-semibold tracking-tight">
            {t("stepsTitle")}
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step} className="flex gap-4 rounded-xl border border-stone-200 bg-white p-5">
                <span
                  aria-hidden="true"
                  className="bg-brand-50 text-brand-800 grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold"
                >
                  {index + 1}
                </span>
                <span className="text-stone-700">{t(`steps.${step}`)}</span>
              </li>
            ))}
          </ol>
          <div className="mt-12 rounded-2xl bg-stone-900 px-6 py-10 text-white sm:px-10">
            <h2 className="text-2xl font-semibold tracking-tight">{t("closingTitle")}</h2>
            <p className="mt-3 max-w-2xl text-stone-300">{t("closingText")}</p>
            <Link
              href="/connexion"
              className="mt-6 inline-block rounded-lg bg-white px-5 py-3 font-medium text-stone-900 hover:bg-stone-200"
            >
              {t("closingCta")}
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
