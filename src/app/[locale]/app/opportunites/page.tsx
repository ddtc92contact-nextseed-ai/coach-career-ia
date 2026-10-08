import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { EmptyState, PageTitle } from "@/components/empty-state";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireUser } from "@/lib/auth/session";
import { displaySummary } from "@/lib/matching/explanation";
import {
  getOpportunities,
  SCORE_FILTERS,
  STATUS_FILTERS,
  type StatusFilter,
} from "@/lib/matching/repository";
import { OfferFacts, ScoreBadge, StatusActions } from "./opportunity-parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opportunities");
  return { title: t("title") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const selectClass =
  "mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm";
const actionClass =
  "inline-block rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary hover:bg-primary-hover";

export default async function OpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const status = (STATUS_FILTERS as readonly string[]).includes(param(params.statut))
    ? (param(params.statut) as StatusFilter)
    : "active";
  const scoreParam = Number(param(params.score));
  const minScore = (SCORE_FILTERS as readonly number[]).includes(scoreParam) ? scoreParam : 0;

  const [t, format, locale, data] = await Promise.all([
    getTranslations("opportunities"),
    getFormatter(),
    getLocale() as Promise<AppLocale>,
    getOpportunities(user.id, { status, minScore }),
  ]);
  const filtered = status !== "active" || minScore > 0;

  let empty: React.ReactNode = null;
  if (data.blocker === "noMemory") {
    empty = (
      <EmptyState
        title={t("empty.noMemoryTitle")}
        text={t("empty.noMemoryText")}
        action={
          <Link href="/app/memoire" className={actionClass}>
            {t("empty.noMemoryAction")}
          </Link>
        }
      />
    );
  } else if (data.blocker === "noGuardRails") {
    empty = (
      <EmptyState
        title={t("empty.noRailsTitle")}
        text={t("empty.noRailsText")}
        action={
          <Link href="/app/garde-fous" className={actionClass}>
            {t("empty.noRailsAction")}
          </Link>
        }
      />
    );
  } else if (data.items.length === 0) {
    empty = filtered ? (
      <EmptyState title={t("empty.noResultTitle")} text={t("empty.noResultText")} />
    ) : data.pending || !data.computedAt ? (
      <EmptyState title={t("empty.pendingTitle")} text={t("empty.pendingText")} />
    ) : (
      <EmptyState title={t("empty.noMatchTitle")} text={t("empty.noMatchText")} />
    );
  }

  return (
    <>
      <PageTitle title={t("title")} intro={t("intro")} />

      {data.blocker === null ? (
        <>
          <form
            method="get"
            aria-label={t("filters.label")}
            className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:items-end"
          >
            <label className="text-ink block text-sm font-medium sm:w-56">
              {t("filters.status")}
              <select name="statut" defaultValue={status} className={selectClass}>
                {STATUS_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {t(`filters.statusOptions.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-ink block text-sm font-medium sm:w-44">
              {t("filters.minScore")}
              <select name="score" defaultValue={String(minScore)} className={selectClass}>
                {SCORE_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {value === 0
                      ? t("filters.anyScore")
                      : t("filters.scoreOption", { score: value })}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="border-line-strong bg-surface hover:bg-muted col-span-2 rounded-lg border px-4 py-2 text-sm font-medium sm:col-span-1"
            >
              {t("filters.apply")}
            </button>
          </form>

          <div className="text-ink-subtle mb-4 flex flex-col gap-1 text-sm sm:flex-row sm:justify-between">
            <p>
              {t("count", { count: data.items.length })}
              {data.computedAt
                ? ` · ${t("lastComputed", { date: format.dateTime(data.computedAt, { dateStyle: "medium", timeStyle: "short" }) })}`
                : null}
            </p>
            <p>
              {t.rich("alertsHint", {
                link: (chunks) => (
                  <Link
                    href="/app/parametres#alertes"
                    className="text-brand-ink underline underline-offset-4"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
          {data.pending && data.items.length > 0 ? (
            <p
              role="status"
              className="border-warning-line bg-warning-soft text-warning-ink mb-4 rounded-lg border px-4 py-2 text-sm"
            >
              {t("pending")}
            </p>
          ) : null}
        </>
      ) : null}

      {empty ?? (
        <ul className="space-y-3">
          {data.items.map((match) => (
            <li key={match.id} className="border-line bg-surface rounded-xl border p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold break-words">
                    <Link href={`/app/opportunites/${match.id}`} className="hover:underline">
                      {match.offer.title}
                    </Link>
                  </h2>
                  <OfferFacts offer={match.offer} />
                </div>
                <ScoreBadge score={match.score} />
              </div>
              <p className="text-ink-muted mt-3 text-sm">
                {displaySummary(match.explanation, match.score, locale)}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {match.status === "NEW" || match.status === "SAVED" ? (
                    <Badge tone={match.status === "SAVED" ? "proven" : "neutral"}>
                      {t(`status.${match.status}`)}
                    </Badge>
                  ) : null}
                  <Link
                    href={`/app/opportunites/${match.id}`}
                    className="text-brand-ink text-sm font-medium underline underline-offset-4"
                  >
                    {t("actions.details")}
                  </Link>
                </div>
                <StatusActions id={match.id} status={match.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
