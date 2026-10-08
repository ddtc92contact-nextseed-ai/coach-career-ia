import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { scoreBand, type Explanation } from "@/lib/matching/explanation";
import type { MatchView } from "@/lib/matching/repository";
import type { UnknownCode } from "@/lib/matching/types";
import { changeMatchStatus } from "./actions";

const BAND_STROKE = {
  strong: "text-brand",
  good: "text-brand/70",
  fair: "text-ink-subtle",
} as const;

/**
 * Jauge circulaire du score de correspondance (0–100), colorée selon la force
 * de la correspondance. Le nombre est lisible sans la couleur.
 */
export async function ScoreGauge({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  const t = await getTranslations("opportunities");
  const band = scoreBand(score);
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const value = Math.max(0, Math.min(100, score));
  return (
    <div
      role="img"
      aria-label={t("scoreLabel", { score })}
      title={t("scoreLabel", { score })}
      className={`relative inline-flex shrink-0 flex-col items-center justify-center ${
        size === "lg" ? "size-28" : "size-[4.5rem]"
      }`}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={radius} fill="none" strokeWidth="4" className="stroke-muted" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
          className={BAND_STROKE[band]}
        />
      </svg>
      <span
        aria-hidden="true"
        className={`font-display relative leading-none font-bold tabular-nums ${
          size === "lg" ? "text-3xl" : "text-xl"
        }`}
      >
        {value}
      </span>
      <span
        aria-hidden="true"
        className={`text-ink-subtle relative font-medium ${size === "lg" ? "text-sm" : "text-xs"}`}
      >
        /100
      </span>
    </div>
  );
}

/** Ligne de qualification sous la jauge : « Excellente / Bonne / Correspondance partielle ». */
export async function ScoreBandLabel({ score }: { score: number }) {
  const t = await getTranslations("opportunities.band");
  const band = scoreBand(score);
  return (
    <span
      className={`text-sm font-semibold ${band === "fair" ? "text-ink-muted" : "text-brand-ink"}`}
    >
      {t(band)}
    </span>
  );
}

function money(
  format: Awaited<ReturnType<typeof getFormatter>>,
  value: number,
  currency: string | null,
) {
  return format.number(value, {
    style: "currency",
    currency: currency ?? "EUR",
    maximumFractionDigits: 0,
  });
}

/** Salaire annoncé, lisible (« 55 000 € – 65 000 € / an »). */
async function salaryLabel(offer: MatchView["offer"]): Promise<string> {
  const [t, format] = await Promise.all([getTranslations("opportunities"), getFormatter()]);
  const { salaryMin: min, salaryMax: max } = offer;
  if (min === null && max === null) return t("salary.notStated");
  const m = (v: number) => money(format, v, offer.salaryCurrency);
  let salary =
    min !== null && max !== null
      ? min === max
        ? m(min)
        : t("salary.range", { min: m(min), max: m(max) })
      : min !== null
        ? t("salary.from", { min: m(min) })
        : t("salary.upTo", { max: m(max!) });
  if (offer.salaryPeriod) salary = `${salary} ${t(`salary.period.${offer.salaryPeriod}`)}`;
  return salary;
}

function Fact({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <li className="bg-subtle text-ink-muted ring-line inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ring-1 ring-inset">
      <Icon name={icon} className="text-ink-subtle size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

/** Entreprise, lieu, contrat, télétravail et salaire annoncés. */
export async function OfferFacts({
  offer,
  showCompany = true,
}: {
  offer: MatchView["offer"];
  /** Masque la ligne « entreprise · lieu » quand l'en-tête l'affiche déjà. */
  showCompany?: boolean;
}) {
  const t = await getTranslations("opportunities");
  const salary = await salaryLabel(offer);
  return (
    <>
      {showCompany ? <p className="text-ink-muted">{companyLine(offer, t)}</p> : null}
      <ul className={`flex flex-wrap gap-2 ${showCompany ? "mt-3" : ""}`}>
        <Fact icon="briefcase">{t(`contract.${offer.contractType}`)}</Fact>
        <Fact icon="home">{t(`remote.${offer.remotePolicy}`)}</Fact>
        <Fact icon="coins">{salary}</Fact>
      </ul>
      {offer.direct ? (
        <p className="mt-3">
          <Badge tone="proven" icon="building">
            {t("directBadge")}
          </Badge>
        </p>
      ) : null}
    </>
  );
}

/** « Entreprise · Ville » (valeurs par défaut quand l'offre ne les donne pas). */
export function companyLine(
  offer: MatchView["offer"],
  t: Awaited<ReturnType<typeof getTranslations<"opportunities">>>,
): string {
  const place = [offer.city, offer.country && offer.country !== "FR" ? offer.country : null]
    .filter(Boolean)
    .join(", ");
  return [offer.companyName ?? t("companyUnknown"), place || t("placeUnknown")].join(" · ");
}

/** Garde-fous vérifiés pour chaque offre, et l'information qui permet de le faire. */
const RAIL_CHECKS: {
  key: "salary" | "remote" | "contract" | "location";
  unknowns: UnknownCode[];
}[] = [
  { key: "salary", unknowns: ["salaryNotStated"] },
  { key: "remote", unknowns: ["remoteNotStated", "remoteDaysNotStated"] },
  { key: "contract", unknowns: ["contractNotStated"] },
  { key: "location", unknowns: ["locationNotChecked"] },
];

/**
 * Garde-fous cochés : une offre proposée n'en viole aucun (filtres durs) ;
 * quand l'offre ne donne pas l'information, le point est « à vérifier ».
 */
export async function RailChecks({
  explanation,
  compact = false,
}: {
  explanation: Explanation | null;
  compact?: boolean;
}) {
  const t = await getTranslations("opportunities.rails");
  const unknowns = new Set(explanation?.unknowns ?? []);
  const checks = RAIL_CHECKS.map((check) => ({
    key: check.key,
    unknown: check.unknowns.some((code) => unknowns.has(code)),
  }));
  if (compact) {
    const toCheck = checks.filter((c) => c.unknown).length;
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-brand-ink inline-flex items-center gap-1.5 font-medium">
          <Icon name="shield" className="size-4" />
          {t("summary")}
        </span>
        {toCheck > 0 ? (
          <span className="text-warning-ink inline-flex items-center gap-1.5">
            <Icon name="help" className="size-4" />
            {t("toCheck", { count: toCheck })}
          </span>
        ) : null}
      </p>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {checks.map(({ key, unknown }) => (
        <li
          key={key}
          className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1 ring-inset ${
            unknown
              ? "bg-warning-soft text-warning-ink ring-warning-line"
              : "bg-brand-soft text-brand-ink ring-brand-line"
          }`}
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
              unknown ? "bg-warning-line/60" : "bg-brand text-on-brand"
            }`}
          >
            <Icon name={unknown ? "help" : "check"} className="size-3.5" strokeWidth={2.5} />
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{t(`items.${key}`)}</span>
            <span className="block text-sm opacity-90">{unknown ? t("unknown") : t("ok")}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Sauvegarder / écarter / remettre dans la liste (formulaires d'actions serveur, sans JavaScript). */
export async function StatusActions({ id, status }: { id: string; status: MatchView["status"] }) {
  const t = await getTranslations("opportunities.actions");
  return (
    <div className="flex flex-wrap gap-2">
      {status === "DISMISSED" ? (
        <form action={changeMatchStatus.bind(null, id, "SEEN")}>
          <button type="submit" className={buttonClass("secondary", "sm")}>
            <Icon name="refresh" className="size-4" />
            {t("restore")}
          </button>
        </form>
      ) : (
        <>
          <form action={changeMatchStatus.bind(null, id, status === "SAVED" ? "SEEN" : "SAVED")}>
            <button
              type="submit"
              className={buttonClass("secondary", "sm")}
              aria-pressed={status === "SAVED"}
            >
              <Icon
                name="bookmark"
                className={`size-4 ${status === "SAVED" ? "fill-current" : ""}`}
              />
              {status === "SAVED" ? t("unsave") : t("save")}
            </button>
          </form>
          <form action={changeMatchStatus.bind(null, id, "DISMISSED")}>
            <button type="submit" className={buttonClass("ghost", "sm")}>
              {t("dismiss")}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
