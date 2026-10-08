import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import type { CompanySignalView } from "@/lib/radar/signals/query";

const STRENGTH = { 1: "weak", 2: "medium", 3: "strong" } as const;

type Translate = Awaited<ReturnType<typeof getTranslations<"companySignals">>>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

/** Explication en langage courant d'un signal, à partir de ses faits structurés. */
function explain(signal: CompanySignalView, t: Translate, format: Format, locale: string) {
  const f = signal.facts;
  switch (f.type) {
    case "HIRING_SURGE":
      return [
        t("explanations.HIRING_SURGE", {
          newOffers: f.newOffers,
          baselineNew: f.baselineNew,
          openCount: f.openCount,
        }),
      ];
    case "HIRING_FREEZE":
      return [
        t("explanations.HIRING_FREEZE", {
          quietWeeks: f.quietWeeks,
          closedOffers: f.closedOffers,
          openBefore: f.openBefore,
        }),
      ];
    case "NEW_TEAM":
      return [
        ...(f.families.length > 0
          ? [
              t("explanations.NEW_TEAM_FAMILIES", {
                families: format.list(f.families.map((family) => t(`families.${family}`))),
              }),
            ]
          : []),
        ...(f.leadership ? [t("explanations.NEW_TEAM_LEADERSHIP")] : []),
      ];
    case "NEW_LOCATION": {
      const regions = new Intl.DisplayNames([locale], { type: "region" });
      const places = [...f.cities, ...f.countries.map((c) => regions.of(c) ?? c)];
      return [t("explanations.NEW_LOCATION", { places: format.list(places) })];
    }
    case "REPOSTED_OFFER":
      return [
        t("explanations.REPOSTED_OFFER", {
          count: f.count,
          titles: format.list(f.titles),
        }),
      ];
    case "REMOTE_SHIFT":
      return [
        t("explanations.REMOTE_SHIFT", {
          direction: f.direction,
          recentShare: f.recentShare,
          baselineShare: f.baselineShare,
        }),
      ];
  }
}

/** Liste de signaux d'entreprise, chacun avec son explication (offre, page admin). */
export async function CompanySignalList({
  signals,
  compact = false,
}: {
  signals: CompanySignalView[];
  compact?: boolean;
}) {
  const [t, format, locale] = await Promise.all([
    getTranslations("companySignals"),
    getFormatter(),
    getLocale(),
  ]);
  return (
    <ul className={compact ? "space-y-2" : "space-y-4"}>
      {signals.map((signal) => (
        <li key={signal.id}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={compact ? "text-xs font-semibold" : "text-sm font-semibold"}>
              {t(`types.${signal.type}`)}
            </span>
            <Badge tone={signal.strength >= 3 ? "proven" : "neutral"}>
              {t(`strength.${STRENGTH[signal.strength as 1 | 2 | 3] ?? "weak"}`)}
            </Badge>
            <span className="text-ink-subtle text-xs">
              {t("week", { date: format.dateTime(signal.periodStart, "short") })}
            </span>
          </div>
          {explain(signal, t, format, locale).map((line) => (
            <p key={line} className={`text-ink-muted mt-1 ${compact ? "text-xs" : "text-sm"}`}>
              {line}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
