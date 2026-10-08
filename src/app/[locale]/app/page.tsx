import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { Card, CardHeader } from "@/components/card";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import type { CompletenessStep } from "@/lib/career/derive";
import { getDashboard, getGuardRails } from "@/lib/career/repository";
import { listContacts } from "@/lib/contact/repository";
import { getOpportunities } from "@/lib/matching/repository";
import { RailsSummary } from "./garde-fous/rails-summary";
import { ScoreBadge } from "./opportunites/opportunity-parts";
import { VisibilityForm } from "./visibility-form";

const STEP_LINKS: Record<CompletenessStep, string> = {
  addExperience: "/app/memoire/experiences/nouvelle",
  addAchievement: "/app/memoire/realisations/nouvelle",
  addProof: "/app/memoire#realisations",
  moreProofs: "/app/memoire/realisations/nouvelle",
  provenSkills: "/app/memoire#competences",
  setSalary: "/app/garde-fous",
  setLocation: "/app/garde-fous",
  setContractTypes: "/app/garde-fous",
};

/** Nombre d'opportunités et de brouillons montrés sur l'accueil. */
const PREVIEW_COUNT = 3;

const linkClass =
  "text-brand-ink inline-flex items-center gap-1.5 font-semibold underline-offset-4 hover:underline";

export default async function DashboardPage() {
  const user = await requireUser();
  const [t, to, tc, format, dashboard, rails, opportunities, contacts] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("opportunities"),
    getTranslations("contacts"),
    getFormatter(),
    getDashboard(user.id),
    getGuardRails(user.id),
    getOpportunities(user.id, { status: "active", minScore: 0 }),
    listContacts(user.id),
  ]);
  const { completeness, counts } = dashboard;
  const nextStep = completeness.todo[0];
  const drafts = contacts.filter((c) => c.status === "DRAFT");
  const unread = contacts.filter((c) => c.unread > 0);
  const latest = opportunities.items.slice(0, PREVIEW_COUNT);

  return (
    <>
      <PageHeader
        band="night"
        eyebrow={t("eyebrow")}
        title={t("title")}
        lead={t("intro")}
        actions={
          <Link
            href={nextStep ? STEP_LINKS[nextStep] : "/app/opportunites"}
            className={buttonClass("signal", "lg")}
          >
            {nextStep ? t(`completeness.steps.${nextStep}.title`) : t("cta.opportunities")}
            <Icon name="arrow" className="size-5" />
          </Link>
        }
      >
        <div className="mt-8 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="border-night-line bg-night-raised/70 col-span-2 rounded-2xl border p-4 xl:col-span-1">
            <p className="font-display text-signal text-4xl leading-none font-bold tabular-nums">
              {format.number(completeness.score / 100, "percent")}
            </p>
            <p id="completude" className="text-on-night-muted mt-1.5 text-sm">
              {t("stats.completeness")}
            </p>
            <div
              role="progressbar"
              aria-labelledby="completude"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={completeness.score}
              className="bg-night mt-3 h-2.5 overflow-hidden rounded-full"
            >
              <div
                className="bg-signal h-full rounded-full"
                style={{ width: `${completeness.score}%` }}
              />
            </div>
          </div>
          <StatTile
            tone="night"
            icon="spark"
            value={format.number(counts.achievements)}
            label={t("stats.achievements", { count: counts.achievements })}
          />
          <StatTile
            tone="night"
            icon="proof"
            value={format.number(counts.provenAchievements)}
            label={t("stats.proven", { count: counts.provenAchievements })}
          />
          <StatTile
            tone="night"
            icon="briefcase"
            value={format.number(counts.experiences)}
            label={t("stats.experiences", { count: counts.experiences })}
          />
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card aria-labelledby="prochaines-etapes" className="lg:col-span-2">
          <CardHeader
            id="prochaines-etapes"
            title={t("completeness.nextSteps")}
            description={t("completeness.summary", {
              achievements: counts.achievements,
              proven: counts.provenAchievements,
            })}
          />
          {completeness.todo.length > 0 ? (
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {completeness.todo.map((step) => (
                <li key={step}>
                  <Link
                    href={STEP_LINKS[step]}
                    className="group border-line bg-subtle hover:border-brand-line hover:bg-brand-soft flex h-full items-start gap-3 rounded-xl border p-4 motion-safe:transition-colors"
                  >
                    <span className="bg-surface text-brand-ink ring-line inline-flex size-9 shrink-0 items-center justify-center rounded-lg ring-1">
                      <Icon name="arrow" className="size-4" />
                    </span>
                    <span>
                      <span className="block font-semibold">
                        {t(`completeness.steps.${step}.title`)}
                      </span>
                      <span className="text-ink-muted mt-0.5 block text-sm">
                        {t(`completeness.steps.${step}.text`)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bg-brand-soft text-brand-ink mt-5 flex items-center gap-2 rounded-xl px-4 py-3 font-medium">
              <Icon name="approve" className="size-5 shrink-0" />
              {t("completeness.complete")}
            </p>
          )}
        </Card>

        <Card aria-labelledby="en-attente" tone="brand">
          <CardHeader
            id="en-attente"
            title={t("approvals.title")}
            description={t("approvals.intro")}
          />
          {drafts.length === 0 && unread.length === 0 ? (
            <p className="text-ink-muted border-brand-line bg-surface/70 mt-5 flex items-center gap-3 rounded-xl border px-4 py-3">
              <Icon name="approve" className="text-brand-ink size-5 shrink-0" />
              {t("approvals.empty")}
            </p>
          ) : (
            <ul className="mt-5 space-y-3">
              {drafts.slice(0, PREVIEW_COUNT).map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/app/contacts/${c.id}`}
                    className="border-brand-line bg-surface hover:border-brand flex items-start gap-3 rounded-xl border p-3.5 shadow-xs motion-safe:transition-colors"
                  >
                    <span className="bg-warning-soft text-warning-ink inline-flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <Icon name="send" className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold break-words">{c.offer.title}</span>
                      <span className="text-ink-muted block text-sm">
                        {[c.offer.companyName ?? tc("companyUnknown"), t("approvals.draft")].join(
                          " · ",
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {unread.slice(0, PREVIEW_COUNT).map((c) => (
                <li key={`reply-${c.id}`}>
                  <Link
                    href={`/app/contacts/${c.id}`}
                    className="border-brand-line bg-surface hover:border-brand flex items-start gap-3 rounded-xl border p-3.5 shadow-xs motion-safe:transition-colors"
                  >
                    <span className="bg-brand-soft text-brand-ink inline-flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <Icon name="chat" className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold break-words">{c.offer.title}</span>
                      <span className="text-ink-muted block text-sm">
                        {tc("unread", { count: c.unread })}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-5">
            <Link href="/app/contacts" className={linkClass}>
              {t("approvals.open")}
              <Icon name="arrow" className="size-4" />
            </Link>
          </p>
        </Card>
      </div>

      <Card aria-labelledby="opportunites-recentes" className="mt-6">
        <CardHeader
          id="opportunites-recentes"
          title={t("opportunities.title")}
          description={t("opportunities.intro")}
          actions={
            <Link href="/app/opportunites" className={buttonClass("secondary")}>
              {t("opportunities.all")}
            </Link>
          }
        />
        {opportunities.blocker ? (
          <div className="border-line-strong mt-5 flex flex-col gap-4 rounded-xl border border-dashed p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">
                {to(
                  opportunities.blocker === "noMemory"
                    ? "empty.noMemoryTitle"
                    : "empty.noRailsTitle",
                )}
              </p>
              <p className="text-ink-muted mt-1 text-sm">
                {to(
                  opportunities.blocker === "noMemory" ? "empty.noMemoryText" : "empty.noRailsText",
                )}
              </p>
            </div>
            <Link
              href={opportunities.blocker === "noMemory" ? "/app/memoire" : "/app/garde-fous"}
              className={`${buttonClass("secondary")} shrink-0`}
            >
              {to(
                opportunities.blocker === "noMemory"
                  ? "empty.noMemoryAction"
                  : "empty.noRailsAction",
              )}
            </Link>
          </div>
        ) : latest.length === 0 ? (
          <p className="text-ink-muted border-line-strong mt-5 flex items-center gap-3 rounded-xl border border-dashed p-5">
            <Icon name="radar" className="text-brand-ink size-6 shrink-0" />
            {t("opportunities.empty")}
          </p>
        ) : (
          <ul className="mt-5 grid gap-4 md:grid-cols-3">
            {latest.map((match) => (
              <li key={match.id}>
                <Link
                  href={`/app/opportunites/${match.id}`}
                  className="group border-line bg-subtle hover:border-brand-line hover:bg-surface flex h-full flex-col rounded-xl border p-4 hover:shadow-md motion-safe:transition-[border-color,box-shadow,background-color]"
                >
                  <span className="flex items-start justify-between gap-3">
                    <ScoreBadge score={match.score} />
                    {match.status === "NEW" ? <Badge>{to("status.NEW")}</Badge> : null}
                  </span>
                  <span className="mt-3 block font-semibold break-words group-hover:underline">
                    {match.offer.title}
                  </span>
                  <span className="text-ink-muted mt-1 flex items-center gap-1.5 text-sm">
                    <Icon name="building" className="size-4 shrink-0" />
                    <span className="min-w-0 break-words">
                      {match.offer.companyName ?? to("companyUnknown")}
                    </span>
                  </span>
                  {match.offer.city ? (
                    <span className="text-ink-muted mt-1 flex items-center gap-1.5 text-sm">
                      <Icon name="pin" className="size-4 shrink-0" />
                      <span className="min-w-0 break-words">{match.offer.city}</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="garde-fous-resume" className="mt-6">
        <CardHeader
          id="garde-fous-resume"
          title={t("rails.title")}
          description={t("rails.intro")}
          actions={
            <Link href="/app/garde-fous" className={buttonClass("secondary")}>
              <Icon name="edit" className="size-4" />
              {t("rails.edit")}
            </Link>
          }
        />
        <div className="mt-5">
          <RailsSummary rails={rails} />
        </div>
      </Card>

      <Card aria-labelledby="visibilite" className="mt-6">
        <CardHeader
          id="visibilite"
          title={t("visibility.title")}
          description={t("visibility.intro")}
        />
        <div className="mt-5">
          <VisibilityForm current={dashboard.visibility} />
        </div>
      </Card>
    </>
  );
}
