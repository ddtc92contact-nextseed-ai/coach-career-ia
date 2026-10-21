import { getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Card, CardHeader } from "@/components/card";
import { Icon, type IconName } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import type { FirstRunGuide, FirstRunStep } from "@/lib/career/derive";

/** Destination de chaque étape du démarrage. */
export const FIRST_RUN_LINKS: Record<FirstRunStep, string> = {
  memory: "/app/memoire/importer",
  guardRails: "/app/garde-fous",
  opportunities: "/app/opportunites",
};

/** Saisie manuelle : alternative secondaire à l'import. */
export const MANUAL_ENTRY_LINK = "/app/memoire/experiences/nouvelle";

const ICONS: Record<FirstRunStep, IconName> = {
  memory: "upload",
  guardRails: "shield",
  opportunities: "target",
};

/**
 * Guide « bien démarrer » du tableau de bord : import du parcours, garde-fous,
 * premières opportunités. Affiché tant que la mémoire et les garde-fous ne
 * sont pas posés (`firstRunGuide`).
 */
export async function FirstRunGuidePanel({ guide }: { guide: FirstRunGuide }) {
  const t = await getTranslations("dashboard.firstRun");
  const position = guide.steps.findIndex((s) => s.state === "current") + 1;
  return (
    <Card aria-labelledby="bien-demarrer" tone="brand" className="mb-6">
      <CardHeader
        id="bien-demarrer"
        title={t("title")}
        description={t("intro")}
        actions={
          <p className="bg-surface/80 ring-brand-line text-brand-ink inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold ring-1">
            {t("progress", { current: position, total: guide.steps.length })}
          </p>
        }
      />
      <ol className="mt-6 grid gap-3 lg:grid-cols-3">
        {guide.steps.map(({ step, state }, index) => (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className={`flex gap-4 rounded-2xl border p-4 sm:p-5 ${
              state === "current"
                ? "border-brand bg-surface ring-brand-line shadow-md ring-2"
                : "border-brand-line bg-surface/60"
            }`}
          >
            <span
              aria-hidden
              className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-base font-bold ${
                state === "done"
                  ? "bg-brand text-on-brand"
                  : state === "current"
                    ? "bg-primary text-on-primary"
                    : "bg-muted text-ink-muted"
              }`}
            >
              {state === "done" ? <Icon name="check" className="size-5" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-ink-muted text-xs font-semibold tracking-wide uppercase">
                {t(`states.${state}`)}
              </p>
              <h3 className="mt-0.5 flex items-center gap-2 font-semibold text-balance">
                <Icon name={ICONS[step]} className="text-brand-ink size-5 shrink-0" />
                {t(`steps.${step}.title`)}
              </h3>
              <p className="text-ink-muted mt-1 text-sm text-pretty">{t(`steps.${step}.text`)}</p>
              {state === "current" ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <Link href={FIRST_RUN_LINKS[step]} className={buttonClass("primary")}>
                    {t(`steps.${step}.cta`)}
                    <Icon name="arrow" className="size-4" />
                  </Link>
                  {step === "memory" ? (
                    <Link
                      href={MANUAL_ENTRY_LINK}
                      className="text-ink-muted hover:text-ink inline-flex min-h-11 items-center justify-center px-2 text-sm font-medium underline underline-offset-4"
                    >
                      {t("manual")}
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
