import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { scoreBand } from "@/lib/matching/explanation";
import type { MatchView } from "@/lib/matching/repository";
import { changeMatchStatus } from "./actions";

/** Pastille de score, colorée selon la force de la correspondance. */
export async function ScoreBadge({ score }: { score: number }) {
  const t = await getTranslations("opportunities");
  const tone = {
    strong: "bg-brand text-on-brand",
    good: "bg-brand-soft text-brand-ink ring-1 ring-brand-line ring-inset",
    fair: "bg-muted text-ink-muted ring-1 ring-line ring-inset",
  }[scoreBand(score)];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${tone}`}
      aria-label={t("scoreLabel", { score })}
      title={t("scoreLabel", { score })}
    >
      {t("score", { score })}
    </span>
  );
}

/** Entreprise, lieu, contrat, télétravail et salaire annoncés. */
export async function OfferFacts({ offer }: { offer: MatchView["offer"] }) {
  const [t, format] = await Promise.all([getTranslations("opportunities"), getFormatter()]);
  const money = (value: number) =>
    format.number(value, {
      style: "currency",
      currency: offer.salaryCurrency ?? "EUR",
      maximumFractionDigits: 0,
    });
  let salary: string = t("salary.notStated");
  const { salaryMin: min, salaryMax: max } = offer;
  if (min !== null || max !== null) {
    salary =
      min !== null && max !== null
        ? min === max
          ? money(min)
          : t("salary.range", { min: money(min), max: money(max) })
        : min !== null
          ? t("salary.from", { min: money(min) })
          : t("salary.upTo", { max: money(max!) });
    if (offer.salaryPeriod) salary = `${salary} ${t(`salary.period.${offer.salaryPeriod}`)}`;
  }
  const place = [offer.city, offer.country && offer.country !== "FR" ? offer.country : null]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      <p className="text-ink-muted text-sm">
        {[offer.companyName ?? t("companyUnknown"), place || t("placeUnknown")].join(" · ")}
      </p>
      <p className="text-ink-subtle mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span>{t(`contract.${offer.contractType}`)}</span>
        <span>{t(`remote.${offer.remotePolicy}`)}</span>
        <span>{salary}</span>
      </p>
      {offer.direct ? (
        <p className="mt-2">
          <Badge tone="proven">{t("directBadge")}</Badge>
        </p>
      ) : null}
    </>
  );
}

const buttonClass =
  "rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-muted";

/** Sauvegarder / écarter / remettre dans la liste (formulaires d'actions serveur, sans JavaScript). */
export async function StatusActions({ id, status }: { id: string; status: MatchView["status"] }) {
  const t = await getTranslations("opportunities.actions");
  return (
    <div className="flex flex-wrap gap-2">
      {status === "DISMISSED" ? (
        <form action={changeMatchStatus.bind(null, id, "SEEN")}>
          <button type="submit" className={buttonClass}>
            {t("restore")}
          </button>
        </form>
      ) : (
        <>
          <form action={changeMatchStatus.bind(null, id, status === "SAVED" ? "SEEN" : "SAVED")}>
            <button type="submit" className={buttonClass} aria-pressed={status === "SAVED"}>
              {status === "SAVED" ? t("unsave") : t("save")}
            </button>
          </form>
          <form action={changeMatchStatus.bind(null, id, "DISMISSED")}>
            <button type="submit" className={`${buttonClass} text-ink-muted`}>
              {t("dismiss")}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
