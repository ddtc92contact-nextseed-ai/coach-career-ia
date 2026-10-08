import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { CompanySignalList } from "@/components/company-signals";
import { SalaryBenchmarkBlock } from "@/components/salary-benchmark";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { contactOptions, type ContactError } from "@/lib/contact/repository";
import { displaySummary, factLines } from "@/lib/matching/explanation";
import { getMatch, markMatchSeen } from "@/lib/matching/repository";
import { WEIGHTS } from "@/lib/matching/score";
import { startContactAction } from "../../contacts/actions";
import { BENCHMARK_CONFIG } from "@/lib/radar/benchmarks/config";
import { benchmarkForOffer } from "@/lib/radar/salary-benchmarks";
import { SIGNAL_THRESHOLDS } from "@/lib/radar/signals/config";
import { getCompanySignals } from "@/lib/radar/signals/server";
import { OfferFacts, ScoreBadge, StatusActions } from "../opportunity-parts";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const CONTACT_ERRORS: readonly ContactError[] = ["noChannel", "guardRail", "card"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opportunities");
  return { title: t("title") };
}

const sectionClass = "rounded-2xl border border-line bg-surface p-4 sm:p-6";

export default async function OpportunityPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const [{ id }, query = {}] = await Promise.all([params, searchParams]);
  // Identifiant d'une autre personne, offre fermée ou hors garde-fous : 404.
  const match = await getMatch(user.id, id);
  if (!match) notFound();
  if (match.status === "NEW") await markMatchSeen(user.id, id);

  const [t, tm, tc, tce, ts, tb, format, locale, contact, signals, market] = await Promise.all([
    getTranslations("opportunities"),
    getTranslations("matching"),
    getTranslations("codes.culture"),
    getTranslations("contacts.errors"),
    getTranslations("companySignals"),
    getTranslations("salaryBenchmark"),
    getFormatter(),
    getLocale() as Promise<AppLocale>,
    contactOptions(user.id, id),
    match.offer.companyId
      ? getCompanySignals(match.offer.companyId, {
          limit: SIGNAL_THRESHOLDS.display.maxPerOffer,
        })
      : [],
    benchmarkForOffer(db, match.offer),
  ]);
  const contactError = CONTACT_ERRORS.find((code) => code === query.contact) ?? null;
  const explanation = match.explanation;
  const lines = explanation ? factLines(explanation, locale) : null;
  const fromLlm = explanation?.source === "llm" && explanation.locale === locale;

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/app/opportunites" className="text-ink-muted text-sm hover:underline">
        {t("actions.back")}
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{match.offer.title}</h1>
          <div className="mt-2">
            <OfferFacts offer={match.offer} />
          </div>
          {match.offer.publishedAt ? (
            <p className="text-ink-subtle mt-1 text-xs">
              {t("detail.published", { date: format.dateTime(match.offer.publishedAt, "short") })}
            </p>
          ) : null}
        </div>
        <ScoreBadge score={match.score} />
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {match.offer.direct ? (
          // Offre publiée sur la plateforme : pas d'annonce d'origine ailleurs.
          <span />
        ) : (
          <a
            href={match.offer.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="bg-primary text-on-primary hover:bg-primary-hover inline-block rounded-lg px-4 py-2.5 text-center text-sm font-medium"
          >
            {t("actions.original")}
          </a>
        )}
        <StatusActions id={match.id} status={match.status === "NEW" ? "SEEN" : match.status} />
      </div>

      {match.offer.direct ? (
        <section className={sectionClass}>
          <p className="text-ink-muted text-sm whitespace-pre-line">{match.offer.description}</p>
        </section>
      ) : null}

      {contact ? (
        <section className={sectionClass} aria-labelledby="contacter-titre" id="contacter">
          <h2 id="contacter-titre" className="text-lg font-semibold">
            {t("contact.title")}
          </h2>
          {contact.contact ? (
            <>
              <p className="text-ink-muted mt-2 text-sm">
                {t(`contact.status.${contact.contact.status}`)}
              </p>
              <Link
                href={`/app/contacts/${contact.contact.id}`}
                className="border-line-strong hover:bg-muted mt-3 inline-block rounded-lg border px-4 py-2 text-sm font-medium"
              >
                {t("contact.existing")}
              </Link>
            </>
          ) : contact.channel === null ? (
            <p className="text-ink-muted mt-2 text-sm">{t("contact.none")}</p>
          ) : (
            <>
              <p className="text-ink-muted mt-2 text-sm">
                {t(
                  contact.channel === "PORTAL"
                    ? "contact.portal"
                    : contact.channel === "EMAIL"
                      ? "contact.email"
                      : "contact.applyUrl",
                )}
              </p>
              {contactError ? (
                <p role="alert" className="text-danger-ink mt-2 text-sm">
                  {tce(contactError, { excerpt: "", limit: 0 })}
                </p>
              ) : null}
              {!contact.cardApproved ? (
                <p className="text-warning-ink mt-2 text-sm">
                  {t("contact.cardNeeded")}{" "}
                  <Link href="/app/carte" className="underline">
                    {t("contact.cardLink")}
                  </Link>
                </p>
              ) : (
                <form action={startContactAction.bind(null, match.id)} className="mt-3">
                  <button
                    type="submit"
                    className="bg-primary text-on-primary hover:bg-primary-hover rounded-lg px-4 py-2.5 text-sm font-medium"
                  >
                    {t("contact.button")}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      ) : null}

      <section className={sectionClass} aria-labelledby="pourquoi">
        <h2 id="pourquoi" className="text-lg font-semibold">
          {t("detail.why")}
        </h2>
        <p className="text-ink mt-2">{displaySummary(explanation, match.score, locale)}</p>
        <p className="text-ink-subtle mt-2 text-xs">
          {t(`detail.generatedBy.${fromLlm ? "llm" : "rules"}`)} {t("detail.guardRailsOk")}
        </p>
      </section>

      {explanation && lines ? (
        <>
          <section className={sectionClass} aria-labelledby="preuves">
            <h2 id="preuves" className="text-lg font-semibold">
              {t("detail.proofs")}
            </h2>
            {explanation.matches.length === 0 ? (
              <p className="text-ink-muted mt-2 text-sm">{t("detail.proofsEmpty")}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {explanation.matches.map((m, i) => (
                  <li key={m.achievementId} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                    <span className="shrink-0">
                      <Badge tone={m.proven ? "proven" : "warning"}>
                        {m.proven ? tm("proven") : tm("declared")}
                      </Badge>
                    </span>
                    <span className="text-ink text-sm">{lines.matches[i]}</span>
                  </li>
                ))}
              </ul>
            )}
            {explanation.skills.length > 0 ? (
              <>
                <h3 className="mt-5 text-sm font-semibold">{t("detail.skills")}</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {explanation.skills.map((s) => (
                    <li key={s.name}>
                      <Badge tone={s.proven ? "proven" : "neutral"}>
                        {s.name} · {s.proven ? tm("proven") : tm("declared")}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {explanation.culture.length > 0 ? (
              <>
                <h3 className="mt-5 text-sm font-semibold">{t("detail.culture")}</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {explanation.culture.map((c) => (
                    <li key={c}>
                      <Badge>{tc(c)}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          {lines.gaps.length > 0 || lines.unknowns.length > 0 ? (
            <section className={sectionClass} aria-labelledby="attention">
              {lines.gaps.length > 0 ? (
                <>
                  <h2 id="attention" className="text-lg font-semibold">
                    {t("detail.gaps")}
                  </h2>
                  <ul className="text-ink-muted mt-2 list-disc space-y-1 pl-5 text-sm">
                    {lines.gaps.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {lines.unknowns.length > 0 ? (
                <>
                  <h2
                    id={lines.gaps.length > 0 ? undefined : "attention"}
                    className={`text-lg font-semibold ${lines.gaps.length > 0 ? "mt-5" : ""}`}
                  >
                    {t("detail.unknowns")}
                  </h2>
                  <ul className="text-ink-muted mt-2 list-disc space-y-1 pl-5 text-sm">
                    {lines.unknowns.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}

          <section className={sectionClass} aria-labelledby="detail-score">
            <h2 id="detail-score" className="text-lg font-semibold">
              {t("detail.components")}
            </h2>
            <dl className="mt-3 space-y-3">
              {(Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((key) => (
                <div key={key}>
                  <div className="flex justify-between text-sm">
                    <dt>{tm(`components.${key}`)}</dt>
                    <dd className="tabular-nums">{explanation.components[key]}/100</dd>
                  </div>
                  <div
                    aria-hidden="true"
                    className="bg-muted mt-1 h-2 overflow-hidden rounded-full"
                  >
                    <div
                      className="bg-brand h-full rounded-full"
                      style={{ width: `${explanation.components[key]}%` }}
                    />
                  </div>
                </div>
              ))}
            </dl>
          </section>
        </>
      ) : null}

      {signals.length > 0 ? (
        <section className={sectionClass} aria-labelledby="dynamique">
          <h2 id="dynamique" className="text-lg font-semibold">
            {ts("title")}
          </h2>
          <p className="text-ink-subtle mt-1 mb-3 text-xs">{ts("intro")}</p>
          <CompanySignalList signals={signals} />
        </section>
      ) : null}

      {market ? (
        <section className={sectionClass} aria-labelledby="marche">
          <h2 id="marche" className="text-lg font-semibold">
            {tb("title")}
          </h2>
          <p className="text-ink-subtle mt-1 mb-3 text-xs">{tb("intro")}</p>
          <SalaryBenchmarkBlock
            benchmark={market.benchmark}
            minSample={BENCHMARK_CONFIG.minSample}
            value={market.offerAnnual}
            position={market.position}
            positionKey="offerPosition"
          />
        </section>
      ) : null}

      <section className={sectionClass} aria-labelledby="description">
        <h2 id="description" className="text-lg font-semibold">
          {t("detail.description")}
        </h2>
        <p className="text-ink-muted mt-2 text-sm whitespace-pre-line">{match.offer.description}</p>
      </section>
    </div>
  );
}
