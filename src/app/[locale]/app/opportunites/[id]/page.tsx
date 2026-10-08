import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { Card, CardHeader } from "@/components/card";
import { CompanySignalList } from "@/components/company-signals";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
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
import {
  companyLine,
  OfferFacts,
  RailChecks,
  ScoreBandLabel,
  ScoreGauge,
  StatusActions,
} from "../opportunity-parts";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const CONTACT_ERRORS: readonly ContactError[] = ["noChannel", "guardRail", "card"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opportunities");
  return { title: t("title") };
}

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
    <>
      <Link
        href="/app/opportunites"
        className="text-ink-muted hover:text-ink mb-4 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
      >
        {t("actions.back")}
      </Link>

      <PageHeader
        title={match.offer.title}
        lead={companyLine(match.offer, t)}
        band="brand"
        actions={
          <div className="flex flex-col items-center gap-1">
            <ScoreGauge score={match.score} size="lg" />
            <ScoreBandLabel score={match.score} />
          </div>
        }
      >
        <div className="mt-5">
          <OfferFacts offer={match.offer} showCompany={false} />
        </div>
        {match.offer.publishedAt ? (
          <p className="text-ink-muted mt-3 flex items-center gap-1.5 text-sm">
            <Icon name="clock" className="size-4" />
            {t("detail.published", { date: format.dateTime(match.offer.publishedAt, "short") })}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          {match.offer.direct ? (
            // Offre publiée sur la plateforme : pas d'annonce d'origine ailleurs.
            <span />
          ) : (
            <a
              href={match.offer.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={buttonClass("secondary")}
            >
              {t("actions.original")}
              <Icon name="external" className="size-4" />
            </a>
          )}
          <StatusActions id={match.id} status={match.status === "NEW" ? "SEEN" : match.status} />
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <Card aria-labelledby="pourquoi">
            <CardHeader id="pourquoi" title={t("detail.why")} />
            <p className="text-ink mt-3 text-lg text-pretty">
              {displaySummary(explanation, match.score, locale)}
            </p>
            <p className="text-ink-subtle mt-2 text-sm">
              {t(`detail.generatedBy.${fromLlm ? "llm" : "rules"}`)}
            </p>
            <h3 className="mt-6 flex items-center gap-2 text-lg font-semibold">
              <Icon name="shield" className="text-brand-ink size-5" />
              {t("rails.title")}
            </h3>
            <p className="text-ink-muted mt-1 mb-3">{t("detail.guardRailsOk")}</p>
            <RailChecks explanation={explanation} />
          </Card>

          {explanation && lines ? (
            <>
              <Card aria-labelledby="preuves">
                <CardHeader id="preuves" title={t("detail.proofs")} />
                {explanation.matches.length === 0 ? (
                  <p className="text-ink-muted mt-3">{t("detail.proofsEmpty")}</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {explanation.matches.map((m, i) => (
                      <li
                        key={m.achievementId}
                        className="border-line bg-subtle flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-start sm:gap-3"
                      >
                        <span className="shrink-0">
                          <Badge
                            tone={m.proven ? "proven" : "warning"}
                            icon={m.proven ? "check" : "help"}
                          >
                            {m.proven ? tm("proven") : tm("declared")}
                          </Badge>
                        </span>
                        <span className="text-ink min-w-0 break-words">{lines.matches[i]}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {explanation.skills.length > 0 ? (
                  <>
                    <h3 className="mt-6 text-lg font-semibold">{t("detail.skills")}</h3>
                    <ul className="mt-3 flex flex-wrap gap-2">
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
                    <h3 className="mt-6 text-lg font-semibold">{t("detail.culture")}</h3>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {explanation.culture.map((c) => (
                        <li key={c}>
                          <Badge>{tc(c)}</Badge>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Card>

              {lines.gaps.length > 0 || lines.unknowns.length > 0 ? (
                <Card aria-labelledby="attention">
                  {lines.gaps.length > 0 ? (
                    <>
                      <h2
                        id="attention"
                        className="font-display flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl"
                      >
                        <Icon name="alert" className="text-warning-ink size-5" />
                        {t("detail.gaps")}
                      </h2>
                      <ul className="mt-3 space-y-2">
                        {lines.gaps.map((line) => (
                          <li key={line} className="text-ink-muted flex items-start gap-2">
                            <span
                              aria-hidden="true"
                              className="bg-warning mt-2 size-1.5 shrink-0 rounded-full"
                            />
                            {line}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {lines.unknowns.length > 0 ? (
                    <>
                      <h2
                        id={lines.gaps.length > 0 ? undefined : "attention"}
                        className={`font-display flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl ${
                          lines.gaps.length > 0 ? "mt-6" : ""
                        }`}
                      >
                        <Icon name="help" className="text-ink-subtle size-5" />
                        {t("detail.unknowns")}
                      </h2>
                      <ul className="mt-3 space-y-2">
                        {lines.unknowns.map((line) => (
                          <li key={line} className="text-ink-muted flex items-start gap-2">
                            <span
                              aria-hidden="true"
                              className="bg-ink-subtle mt-2 size-1.5 shrink-0 rounded-full"
                            />
                            {line}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </Card>
              ) : null}

              <Card aria-labelledby="detail-score">
                <CardHeader id="detail-score" title={t("detail.components")} />
                <dl className="mt-4 space-y-4">
                  {(Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((key) => (
                    <div key={key}>
                      <div className="flex justify-between gap-3">
                        <dt className="font-medium">{tm(`components.${key}`)}</dt>
                        <dd className="font-semibold tabular-nums">
                          {explanation.components[key]}/100
                        </dd>
                      </div>
                      <div
                        aria-hidden="true"
                        className="bg-muted mt-2 h-2.5 overflow-hidden rounded-full"
                      >
                        <div
                          className="bg-brand h-full rounded-full"
                          style={{ width: `${explanation.components[key]}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </dl>
              </Card>
            </>
          ) : null}

          <Card aria-labelledby="description">
            <CardHeader id="description" title={t("detail.description")} />
            <p className="text-ink-muted mt-3 break-words whitespace-pre-line">
              {match.offer.description}
            </p>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {contact ? (
            <Card aria-labelledby="contacter-titre" id="contacter" className="scroll-mt-24">
              <CardHeader id="contacter-titre" title={t("contact.title")} />
              {contact.contact ? (
                <>
                  <p className="text-ink-muted mt-3 flex items-start gap-2">
                    <Icon name="mail" className="text-brand-ink mt-0.5 size-5 shrink-0" />
                    {t(`contact.status.${contact.contact.status}`)}
                  </p>
                  <Link
                    href={`/app/contacts/${contact.contact.id}`}
                    className={`${buttonClass("primary")} mt-4 w-full`}
                  >
                    {t("contact.existing")}
                    <Icon name="arrow" className="size-4" />
                  </Link>
                </>
              ) : contact.channel === null ? (
                <p className="text-ink-muted mt-3">{t("contact.none")}</p>
              ) : (
                <>
                  <p className="text-ink-muted mt-3 text-pretty">
                    {t(
                      contact.channel === "PORTAL"
                        ? "contact.portal"
                        : contact.channel === "EMAIL"
                          ? "contact.email"
                          : "contact.applyUrl",
                    )}
                  </p>
                  {contactError ? (
                    <p
                      role="alert"
                      className="border-danger-line bg-danger-soft text-danger-ink mt-3 flex items-start gap-2 rounded-xl border px-3 py-2"
                    >
                      <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
                      {tce(contactError, { excerpt: "", limit: 0 })}
                    </p>
                  ) : null}
                  {!contact.cardApproved ? (
                    <p className="border-warning-line bg-warning-soft text-warning-ink mt-3 rounded-xl border px-3 py-2">
                      {t("contact.cardNeeded")}{" "}
                      <Link
                        href="/app/carte"
                        className="font-semibold underline underline-offset-4"
                      >
                        {t("contact.cardLink")}
                      </Link>
                    </p>
                  ) : (
                    <form action={startContactAction.bind(null, match.id)} className="mt-4">
                      <button type="submit" className={`${buttonClass("primary", "lg")} w-full`}>
                        <Icon name="send" className="size-5" />
                        {t("contact.button")}
                      </button>
                    </form>
                  )}
                </>
              )}
            </Card>
          ) : null}

          {market ? (
            <Card aria-labelledby="marche">
              <CardHeader
                id="marche"
                as="h2"
                title={
                  <span className="flex items-center gap-2">
                    <Icon name="coins" className="text-brand-ink size-5 shrink-0" />
                    {tb("title")}
                  </span>
                }
                description={<span className="text-sm">{tb("intro")}</span>}
              />
              <div className="mt-4">
                <SalaryBenchmarkBlock
                  benchmark={market.benchmark}
                  minSample={BENCHMARK_CONFIG.minSample}
                  value={market.offerAnnual}
                  position={market.position}
                  positionKey="offerPosition"
                />
              </div>
            </Card>
          ) : null}

          {signals.length > 0 ? (
            <Card aria-labelledby="dynamique">
              <CardHeader
                id="dynamique"
                title={
                  <span className="flex items-center gap-2">
                    <Icon name="trend" className="text-brand-ink size-5 shrink-0" />
                    {ts("title")}
                  </span>
                }
                description={<span className="text-sm">{ts("intro")}</span>}
              />
              <div className="mt-4">
                <CompanySignalList signals={signals} />
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
