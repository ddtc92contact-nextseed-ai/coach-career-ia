import { useTranslations } from "next-intl";
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
      className="border-brand-line bg-brand-soft text-brand-ink rounded-xl border px-4 py-4 text-sm"
    >
      <p className="font-medium">{limit === 0 ? t("titlePremiumOnly") : t("title")}</p>
      <p className="mt-1">
        {limit === 0 ? t("textPremiumOnly") : t("text", { limit })}{" "}
        {billing ? t("premium") : t("later")}
      </p>
      {billing ? (
        <Link
          href="/app/billing"
          className="bg-primary text-on-primary hover:bg-primary-hover mt-3 inline-block rounded-lg px-4 py-2 text-sm font-medium"
        >
          {t("cta")}
        </Link>
      ) : null}
    </div>
  );
}
