import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import type { ThinProfileIssue, ThinProfileIssueCode } from "@/lib/career/derive";
import { startConversation } from "./coach/actions";

/** Écran où compléter chaque point faible. */
export const THIN_PROFILE_LINKS: Record<ThinProfileIssueCode, string> = {
  achievements: "/app/memoire/realisations/nouvelle",
  skills: "/app/memoire#competences",
  staleExperience: "/app/memoire#experiences",
};

const ICONS: Record<ThinProfileIssueCode, IconName> = {
  achievements: "spark",
  skills: "check",
  staleExperience: "briefcase",
};

/**
 * Carte « profil mince » (tableau de bord, mémoire de carrière) : les points à
 * compléter, chacun menant à l'écran concerné, et l'aide du coach. Simple
 * avertissement : le matching continue. Rien n'est affiché sans point faible.
 */
export async function ThinProfileCard({
  issues,
  className = "",
}: {
  issues: ThinProfileIssue[];
  className?: string;
}) {
  if (issues.length === 0) return null;
  const [t, format, locale] = await Promise.all([
    getTranslations("thinProfile"),
    getFormatter(),
    getLocale(),
  ]);
  // Années pleines (calculées par l'indicateur), pas un arrondi : « il y a 22 ans ».
  const yearsAgo = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const detail = (issue: ThinProfileIssue) => {
    switch (issue.code) {
      case "achievements":
      case "skills":
        return t(`issues.${issue.code}.text`, { count: issue.count, min: issue.min });
      case "staleExperience":
        return t("issues.staleExperience.text", {
          date: format.dateTime(issue.lastEnd, "month"),
          ago: yearsAgo.format(-issue.years, "year"),
        });
    }
  };

  return (
    <section
      aria-labelledby="profil-mince"
      data-testid="thin-profile-card"
      className={`border-warning-line bg-surface rounded-2xl border border-l-4 p-5 shadow-sm sm:p-6 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="bg-warning-soft text-warning-ink inline-flex size-10 shrink-0 items-center justify-center rounded-xl">
          <Icon name="alert" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2
            id="profil-mince"
            className="font-display text-lg font-bold tracking-tight text-balance sm:text-xl"
          >
            {t("title")}
          </h2>
          <p className="text-ink-muted mt-1 text-pretty">{t("intro")}</p>
        </div>
      </div>
      <ul className="mt-5 grid gap-3 md:grid-cols-3">
        {issues.map((issue) => (
          <li key={issue.code}>
            <Link
              href={THIN_PROFILE_LINKS[issue.code]}
              className="group border-line bg-subtle hover:border-warning-line hover:bg-warning-soft flex h-full items-start gap-3 rounded-xl border p-4 motion-safe:transition-colors"
            >
              <span className="bg-surface text-warning-ink ring-line inline-flex size-9 shrink-0 items-center justify-center rounded-lg ring-1">
                <Icon name={ICONS[issue.code]} className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-semibold group-hover:underline">
                  {t(`issues.${issue.code}.title`)}
                  <Icon name="arrow" className="size-4 shrink-0" />
                </span>
                <span className="text-ink-muted mt-0.5 block text-sm text-pretty">
                  {detail(issue)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <form
        action={startConversation.bind(null, "DISCOVER")}
        className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
      >
        <button type="submit" className={buttonClass("primary")}>
          <Icon name="spark" className="size-4" />
          {t("coach")}
        </button>
        <p className="text-ink-muted text-sm">{t("coachHint")}</p>
      </form>
    </section>
  );
}

/** Avertissement court, en tête de la liste des opportunités. */
export async function ThinProfileNotice({ issues }: { issues: ThinProfileIssue[] }) {
  if (issues.length === 0) return null;
  const t = await getTranslations("thinProfile");
  return (
    <div
      data-testid="thin-profile-notice"
      className="border-warning-line bg-warning-soft text-warning-ink mb-6 flex flex-col gap-2 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-3">
        <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
        <span>{t("notice")}</span>
      </p>
      <Link
        href="/app/memoire"
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 pl-8 font-semibold underline underline-offset-4 sm:pl-0"
      >
        {t("noticeAction")}
        <Icon name="arrow" className="size-4" />
      </Link>
    </div>
  );
}
