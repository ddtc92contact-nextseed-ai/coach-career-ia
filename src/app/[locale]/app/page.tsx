import { getFormatter, getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
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
  { href: "/app/memoire", key: "memory" },
  { href: "/app/garde-fous", key: "guardRails" },
  { href: "/app/opportunites", key: "opportunities" },
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
      <PageTitle title={t("title")} intro={t("intro")} />

      <section
        aria-labelledby="completude"
        className="border-line bg-surface rounded-2xl border p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="completude" className="text-lg font-semibold">
            {t("completeness.title")}
          </h2>
          <p className="text-2xl font-semibold tabular-nums">
            {format.number(completeness.score / 100, "percent")}
          </p>
        </div>
        <div
          role="progressbar"
          aria-labelledby="completude"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completeness.score}
          className="bg-muted mt-3 h-2.5 overflow-hidden rounded-full"
        >
          <div
            className="bg-brand h-full rounded-full"
            style={{ width: `${completeness.score}%` }}
          />
        </div>
        <p className="text-ink-muted mt-3 text-sm">
          {t("completeness.summary", {
            achievements: counts.achievements,
            proven: counts.provenAchievements,
          })}
        </p>
        {completeness.todo.length > 0 ? (
          <>
            <h3 className="mt-5 text-sm font-semibold">{t("completeness.nextSteps")}</h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {completeness.todo.map((step) => (
                <li key={step}>
                  <Link
                    href={STEP_LINKS[step]}
                    className="border-line hover:border-line-strong flex h-full items-start gap-3 rounded-lg border p-3 text-sm"
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
      </section>

      <section aria-labelledby="visibilite" className="mt-8">
        <h2 id="visibilite" className="text-lg font-semibold">
          {t("visibility.title")}
        </h2>
        <p className="text-ink-muted mt-1 mb-4 text-sm">{t("visibility.intro")}</p>
        <VisibilityForm current={dashboard.visibility} />
      </section>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group border-line bg-surface hover:border-line-strong rounded-xl border p-5"
          >
            <h2 className="font-semibold">{t(`sections.${section.key}.title`)}</h2>
            <p className="text-ink-muted mt-2 text-sm">{t(`sections.${section.key}.text`)}</p>
            <p className="text-brand-ink mt-4 text-sm font-medium group-hover:underline">
              {t("open")}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
