import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireUser } from "@/lib/auth/session";
import { displaySummary, factLines } from "@/lib/matching/explanation";
import { getMatch, markMatchSeen } from "@/lib/matching/repository";
import { WEIGHTS } from "@/lib/matching/score";
import { OfferFacts, ScoreBadge, StatusActions } from "../opportunity-parts";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opportunities");
  return { title: t("title") };
}

const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";

export default async function OpportunityPage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  // Identifiant d'une autre personne, offre fermée ou hors garde-fous : 404.
  const match = await getMatch(user.id, id);
  if (!match) notFound();
  if (match.status === "NEW") await markMatchSeen(user.id, id);

  const [t, tm, tc, format, locale] = await Promise.all([
    getTranslations("opportunities"),
    getTranslations("matching"),
    getTranslations("codes.culture"),
    getFormatter(),
    getLocale() as Promise<AppLocale>,
  ]);
  const explanation = match.explanation;
  const lines = explanation ? factLines(explanation, locale) : null;
  const fromLlm = explanation?.source === "llm" && explanation.locale === locale;

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/app/opportunites" className="text-sm text-stone-600 hover:underline">
        {t("actions.back")}
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{match.offer.title}</h1>
          <div className="mt-2">
            <OfferFacts offer={match.offer} />
          </div>
          {match.offer.publishedAt ? (
            <p className="mt-1 text-xs text-stone-500">
              {t("detail.published", { date: format.dateTime(match.offer.publishedAt, "short") })}
            </p>
          ) : null}
        </div>
        <ScoreBadge score={match.score} />
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <a
          href={match.offer.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-block rounded-lg bg-stone-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-stone-700"
        >
          {t("actions.original")}
        </a>
        <StatusActions id={match.id} status={match.status === "NEW" ? "SEEN" : match.status} />
      </div>

      <section className={sectionClass} aria-labelledby="pourquoi">
        <h2 id="pourquoi" className="text-lg font-semibold">
          {t("detail.why")}
        </h2>
        <p className="mt-2 text-stone-800">{displaySummary(explanation, match.score, locale)}</p>
        <p className="mt-2 text-xs text-stone-500">
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
              <p className="mt-2 text-sm text-stone-600">{t("detail.proofsEmpty")}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {explanation.matches.map((m, i) => (
                  <li key={m.achievementId} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                    <span className="shrink-0">
                      <Badge tone={m.proven ? "proven" : "warning"}>
                        {m.proven ? tm("proven") : tm("declared")}
                      </Badge>
                    </span>
                    <span className="text-sm text-stone-800">{lines.matches[i]}</span>
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
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
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
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
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
                    className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100"
                  >
                    <div
                      className="bg-brand-600 h-full rounded-full"
                      style={{ width: `${explanation.components[key]}%` }}
                    />
                  </div>
                </div>
              ))}
            </dl>
          </section>
        </>
      ) : null}

      <section className={sectionClass} aria-labelledby="description">
        <h2 id="description" className="text-lg font-semibold">
          {t("detail.description")}
        </h2>
        <p className="mt-2 text-sm whitespace-pre-line text-stone-700">{match.offer.description}</p>
      </section>
    </div>
  );
}
