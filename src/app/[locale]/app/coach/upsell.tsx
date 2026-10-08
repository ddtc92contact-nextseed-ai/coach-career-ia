import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { Link } from "@/i18n/navigation";

/**
 * Limite gratuite atteinte : un encart d'information (pas une erreur) qui
 * propose Premium quand le paiement est disponible.
 */
export function CoachUpsell({ limit, billing }: { limit: number; billing: boolean }) {
  const t = useTranslations("coach.upsell");
  return (
    <div
      role="status"
      data-tone="night"
      className="band-night on-night border-night-line text-on-night flex flex-col gap-4 rounded-2xl border p-5 shadow-sm sm:flex-row sm:items-center sm:p-6"
    >
      <span
        aria-hidden="true"
        className="bg-night-raised text-signal ring-night-line inline-flex size-11 shrink-0 items-center justify-center rounded-xl ring-1"
      >
        <Icon name="star" className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-bold text-balance">
          {limit === 0 ? t("titlePremiumOnly") : t("title")}
        </p>
        <p className="text-on-night-muted mt-1 text-pretty">
          {limit === 0 ? t("textPremiumOnly") : t("text", { limit })}{" "}
          {billing ? t("premium") : t("later")}
        </p>
      </div>
      {billing ? (
        <Link href="/app/billing" className={`${buttonClass("signal")} shrink-0`}>
          {t("cta")}
          <Icon name="arrow" className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}
