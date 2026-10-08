import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardHeader } from "@/components/card";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import type { CompletenessStep } from "@/lib/career/derive";
import { getDashboard } from "@/lib/career/repository";
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

const SECTIONS = [
  { href: "/app/memoire", key: "memory", icon: "memory" },
  { href: "/app/garde-fous", key: "guardRails", icon: "shield" },
  { href: "/app/opportunites", key: "opportunities", icon: "target" },
] as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const [t, format, dashboard] = await Promise.all([
    getTranslations("dashboard"),
    getFormatter(),
    getDashboard(user.id),
  ]);
  const { completeness, counts } = dashboard;

  return (
    <>
      <PageHeader title={t("title")} lead={t("intro")} band="brand" />

      <Card aria-labelledby="completude">
        <CardHeader
          id="completude"
          title={t("completeness.title")}
          actions={
            <p className="font-display text-brand-ink text-3xl font-bold tabular-nums">
              {format.number(completeness.score / 100, "percent")}
            </p>
          }
        />
        <div
          role="progressbar"
          aria-labelledby="completude"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completeness.score}
          className="bg-muted mt-4 h-3 overflow-hidden rounded-full"
        >
          <div
            className="bg-brand h-full rounded-full"
            style={{ width: `${completeness.score}%` }}
          />
        </div>
        <p className="text-ink-muted mt-3">
          {t("completeness.summary", {
            achievements: counts.achievements,
            proven: counts.provenAchievements,
          })}
        </p>
        {completeness.todo.length > 0 ? (
          <>
            <h3 className="mt-6 text-lg font-semibold">{t("completeness.nextSteps")}</h3>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {completeness.todo.map((step) => (
                <li key={step}>
                  <Link
                    href={STEP_LINKS[step]}
                    className="border-line bg-subtle hover:border-brand-line hover:bg-brand-soft flex h-full items-start gap-3 rounded-xl border p-4 motion-safe:transition-colors"
                  >
                    <span aria-hidden="true" className="text-brand-ink font-semibold">
                      →
                    </span>
                    <span>
                      <span className="block font-medium">
                        {t(`completeness.steps.${step}.title`)}
                      </span>
                      <span className="text-ink-subtle mt-0.5 block">
                        {t(`completeness.steps.${step}.text`)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-brand-ink mt-4 text-sm font-medium">{t("completeness.complete")}</p>
        )}
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

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group border-line bg-surface hover:border-brand-line flex flex-col rounded-2xl border p-6 shadow-sm hover:shadow-md motion-safe:transition-[border-color,box-shadow]"
          >
            <span className="bg-brand-soft text-brand-ink inline-flex size-11 items-center justify-center rounded-xl">
              <Icon name={section.icon} className="size-6" />
            </span>
            <h2 className="mt-4 text-xl font-bold tracking-tight">
              {t(`sections.${section.key}.title`)}
            </h2>
            <p className="text-ink-muted mt-2 flex-1">{t(`sections.${section.key}.text`)}</p>
            <p className="text-brand-ink mt-4 inline-flex items-center gap-1.5 font-semibold group-hover:underline">
              {t("open")}
              <Icon
                name="arrow"
                className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
              />
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
