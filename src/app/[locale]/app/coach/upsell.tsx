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
      className="border-brand-100 bg-brand-50 text-brand-900 rounded-xl border px-4 py-4 text-sm"
    >
      <p className="font-medium">{limit === 0 ? t("titlePremiumOnly") : t("title")}</p>
      <p className="mt-1">
        {limit === 0 ? t("textPremiumOnly") : t("text", { limit })}{" "}
        {billing ? t("premium") : t("later")}
      </p>
      {billing ? (
        <Link
          href="/app/billing"
          className="mt-3 inline-block rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
        >
          {t("cta")}
        </Link>
      ) : null}
    </div>
  );
}
