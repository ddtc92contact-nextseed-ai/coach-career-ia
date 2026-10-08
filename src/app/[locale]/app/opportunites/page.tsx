import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { Card } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
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
import {
  OfferFacts,
  RailChecks,
  ScoreBandLabel,
  ScoreGauge,
  StatusActions,
} from "./opportunity-parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opportunities");
  return { title: t("title") };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const actionClass = buttonClass("primary");

/** Lien de filtre : garde l'autre filtre, omet les valeurs par défaut. */
function filterHref(status: StatusFilter, minScore: number): string {
  const query = new URLSearchParams();
  if (status !== "active") query.set("statut", status);
  if (minScore > 0) query.set("score", String(minScore));
  const qs = query.toString();
  return qs ? `/app/opportunites?${qs}` : "/app/opportunites";
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset motion-safe:transition-colors ${
        active
          ? "bg-primary text-on-primary ring-primary"
          : "bg-surface text-ink-muted ring-line-strong hover:bg-muted hover:text-ink"
      }`}
    >
      {active ? <Icon name="check" className="size-4" /> : null}
      {children}
    </Link>
  );
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const status = (STATUS_FILTERS as readonly string[]).includes(param(params.statut))
    ? (param(params.statut) as StatusFilter)
    : "active";
  const scoreParam = Number(param(params.score));
  const minScore = (SCORE_FILTERS as readonly number[]).includes(scoreParam) ? scoreParam : 0;

  const [t, tn, format, locale, data] = await Promise.all([
    getTranslations("opportunities"),
    getTranslations("app.nav.groups"),
    getFormatter(),
    getLocale() as Promise<AppLocale>,
    getOpportunities(user.id, { status, minScore }),
  ]);
  const filtered = status !== "active" || minScore > 0;

  let empty: React.ReactNode = null;
  if (data.blocker === "noMemory") {
    empty = (
      <EmptyState
        icon="memory"
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
        icon="shield"
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
      <EmptyState
        icon="sliders"
        title={t("empty.noResultTitle")}
        text={t("empty.noResultText")}
        action={
          <Link href="/app/opportunites" className={buttonClass("secondary")}>
            {t("filters.reset")}
          </Link>
        }
      />
    ) : data.pending || !data.computedAt ? (
      <EmptyState icon="radar" title={t("empty.pendingTitle")} text={t("empty.pendingText")} />
    ) : (
      <EmptyState icon="target" title={t("empty.noMatchTitle")} text={t("empty.noMatchText")} />
    );
  }

  return (
    <>
      <PageHeader title={t("title")} lead={t("intro")} eyebrow={tn("agent")} band="brand">
        {data.blocker === null ? (
          <div className="text-ink-muted mt-5 flex flex-wrap gap-2 text-sm">
            <p className="bg-surface/80 ring-brand-line inline-flex items-center gap-2 rounded-full px-3 py-1.5 ring-1">
              <Icon name="target" className="text-brand-ink size-4" />
              <span className="text-ink font-semibold">
                {t("count", { count: data.items.length })}
              </span>
            </p>
            {data.computedAt ? (
              <p className="bg-surface/80 ring-brand-line inline-flex items-center gap-2 rounded-full px-3 py-1.5 ring-1">
                <Icon name="clock" className="text-brand-ink size-4" />
                {t("lastComputed", {
                  date: format.dateTime(data.computedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </PageHeader>

      {data.blocker === null ? (
        <>
          <nav
            aria-label={t("filters.label")}
            className="border-line bg-surface mb-6 space-y-4 rounded-2xl border p-4 shadow-xs sm:p-5"
          >
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
              <p id="filtre-statut" className="text-ink text-sm font-semibold lg:w-32 lg:shrink-0">
                {t("filters.status")}
              </p>
              <ul aria-labelledby="filtre-statut" className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map((value) => (
                  <li key={value}>
                    <Chip href={filterHref(value, minScore)} active={value === status}>
                      {t(`filters.statusOptions.${value}`)}
                    </Chip>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
              <p id="filtre-score" className="text-ink text-sm font-semibold lg:w-32 lg:shrink-0">
                {t("filters.minScore")}
              </p>
              <ul aria-labelledby="filtre-score" className="flex flex-wrap gap-2">
                {SCORE_FILTERS.map((value) => (
                  <li key={value}>
                    <Chip href={filterHref(status, value)} active={value === minScore}>
                      {value === 0
                        ? t("filters.anyScore")
                        : t("filters.scoreOption", { score: value })}
                    </Chip>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {data.pending && data.items.length > 0 ? (
            <p
              role="status"
              className="border-warning-line bg-warning-soft text-warning-ink mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3"
            >
              <span aria-hidden="true" className="relative mt-1.5 flex size-2.5 shrink-0">
                <span className="bg-warning absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping" />
                <span className="bg-warning relative inline-flex size-2.5 rounded-full" />
              </span>
              {t("pending")}
            </p>
          ) : null}
        </>
      ) : null}

      {empty ?? (
        <ul className="space-y-4">
          {data.items.map((match) => (
            <li key={match.id}>
              <Card as="article" aria-labelledby={`offre-${match.id}`}>
                <div className="flex items-start gap-4 sm:gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {match.status === "NEW" ? (
                        <Badge tone="brand">{t(`status.${match.status}`)}</Badge>
                      ) : match.status === "SAVED" ? (
                        <Badge tone="proven" icon="bookmark">
                          {t(`status.${match.status}`)}
                        </Badge>
                      ) : null}
                    </div>
                    <h2
                      id={`offre-${match.id}`}
                      className="font-display text-xl font-bold tracking-tight text-balance break-words sm:text-2xl"
                    >
                      <Link
                        href={`/app/opportunites/${match.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {match.offer.title}
                      </Link>
                    </h2>
                    <div className="mt-1.5">
                      <OfferFacts offer={match.offer} />
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <ScoreGauge score={match.score} />
                    <span className="hidden sm:block">
                      <ScoreBandLabel score={match.score} />
                    </span>
                  </div>
                </div>

                <div className="border-brand-line bg-brand-soft/50 mt-5 rounded-xl border-l-4 px-4 py-3">
                  <p className="text-ink text-pretty">
                    {displaySummary(match.explanation, match.score, locale)}
                  </p>
                  <div className="mt-2">
                    <RailChecks explanation={match.explanation} compact />
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={`/app/opportunites/${match.id}`}
                    className="text-brand-ink inline-flex items-center gap-1.5 font-semibold underline-offset-4 hover:underline"
                  >
                    {t("actions.details")}
                    <Icon name="arrow" className="size-4" />
                  </Link>
                  <StatusActions id={match.id} status={match.status} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {data.blocker === null ? (
        <p className="text-ink-muted mt-8 flex items-center gap-2 text-sm">
          <Icon name="bell" className="text-ink-subtle size-4 shrink-0" />
          <span>
            {t.rich("alertsHint", {
              link: (chunks) => (
                <Link
                  href="/app/parametres#alertes"
                  className="text-brand-ink font-medium underline underline-offset-4"
                >
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </p>
      ) : null}
    </>
  );
}
