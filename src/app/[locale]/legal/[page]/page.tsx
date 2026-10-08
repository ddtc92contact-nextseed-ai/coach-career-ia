import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { legalInfo, legalUpdatedAt } from "@/config/legal";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { billingMode } from "@/lib/billing/config";
import { cardLinkTtlDays } from "@/lib/card/tokens";
import { postingDurationDays } from "@/lib/employer/config";
import { handoverTtlDays } from "@/lib/handover/config";
import { localeAlternates } from "@/lib/i18n/metadata";
import { legalPageFromSlug, legalPath } from "@/lib/legal/pages";

type Props = { params: Promise<{ locale: string; page: string }> };

/** Section d'une page : paragraphes (texte) et listes (objet de puces), dans l'ordre du JSON. */
type Section = { title: string; content: Record<string, string | Record<string, string>> };
type RichValues = Record<string, string | number | ((chunks: ReactNode) => ReactNode)>;
type RichTranslator = (key: string, values: RichValues) => ReactNode;

const CNIL_COMPLAINT_URL = "https://www.cnil.fr/fr/adresser-une-plainte";
const linkClass = "text-brand-ink underline underline-offset-2 hover:text-brand-ink";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, page } = await params;
  const key = legalPageFromSlug(page);
  if (!hasLocale(routing.locales, locale) || !key) return {};
  const t = await getTranslations({ locale, namespace: `legal.pages.${key}` });
  return { title: t("title"), alternates: localeAlternates(locale, legalPath(key)) };
}

/**
 * Pages légales publiques (mentions légales, confidentialité, conditions,
 * transparence de l'IA). Les informations de l'éditeur viennent de
 * l'environnement (`LEGAL_*`), lu à chaque requête : jamais figé au build.
 */
export default async function LegalPage({ params }: Props) {
  const { page } = await params;
  const key = legalPageFromSlug(page);
  if (!key) notFound();
  await connection();

  const [t, tl, format] = await Promise.all([
    getTranslations(`legal.pages.${key}`),
    getTranslations("legal"),
    getFormatter(),
  ]);
  // Structure (sections, paragraphes, listes) lue dans le catalogue : les clés
  // varient d'une page à l'autre, la parité entre langues est vérifiée par la CI.
  const sections = (t.raw as (key: string) => unknown)("sections") as Record<string, Section>;
  const internal = (href: string) =>
    function InternalLink(chunks: ReactNode) {
      return (
        <Link href={href} className={linkClass}>
          {chunks}
        </Link>
      );
    };
  const values: RichValues = {
    ...legalInfo(),
    payments: billingMode(),
    cardDays: cardLinkTtlDays(),
    handoverDays: handoverTtlDays(),
    postingDays: postingDurationDays(),
    strong: (chunks) => <strong className="text-ink font-semibold">{chunks}</strong>,
    privacy: internal(legalPath("privacy")),
    terms: internal(legalPath("terms")),
    ai: internal(legalPath("ai")),
    export: internal("/app/parametres#export"),
    delete: internal("/app/parametres#suppression"),
    cnil: (chunks) => (
      <a href={CNIL_COMPLAINT_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {chunks}
      </a>
    ),
  };
  const rich = t.rich as unknown as RichTranslator;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {t("title")}
        </h1>
        <p className="text-ink-subtle mt-3 text-sm">
          {tl("updated", {
            date: format.dateTime(legalUpdatedAt(), { dateStyle: "long", timeZone: "UTC" }),
          })}
        </p>
        <p className="text-ink-muted mt-6 text-lg text-pretty">{rich("intro", values)}</p>

        <nav
          aria-labelledby="legal-contents"
          className="border-line bg-surface mt-8 rounded-xl border p-5"
        >
          <h2 id="legal-contents" className="text-ink text-sm font-semibold">
            {tl("contents")}
          </h2>
          <ol className="mt-3 space-y-1.5 text-sm">
            {Object.entries(sections).map(([id, section]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-ink-muted hover:text-ink hover:underline">
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {Object.entries(sections).map(([id, section]) => (
          <section key={id} id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-6">
            <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
              {section.title}
            </h2>
            <div className="text-ink-muted mt-3 space-y-3 leading-relaxed">
              {Object.entries(section.content).map(([block, value]) => {
                const path = `sections.${id}.content.${block}`;
                if (typeof value === "string") {
                  return <p key={block}>{rich(path, values)}</p>;
                }
                return (
                  <ul key={block} className="marker:text-ink-subtle list-disc space-y-2 pl-5">
                    {Object.keys(value).map((item) => (
                      <li key={item}>{rich(`${path}.${item}`, values)}</li>
                    ))}
                  </ul>
                );
              })}
            </div>
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  );
}
