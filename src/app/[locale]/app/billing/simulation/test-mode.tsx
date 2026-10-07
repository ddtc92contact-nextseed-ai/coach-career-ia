import { useTranslations } from "next-intl";
import { Badge } from "@/components/badge";

/** Pastille « Mode test » : le simulateur de paiement est actif. */
export function TestModeBadge() {
  const t = useTranslations("billing.simulator");
  return (
    <p className="flex flex-col items-start gap-1 sm:items-end">
      <Badge tone="warning">{t("badge")}</Badge>
      <span className="text-xs text-stone-500">{t("badgeHint")}</span>
    </p>
  );
}

/** Bandeau des pages simulées (paiement, gestion de l'abonnement). */
export function SimulatedBanner() {
  const t = useTranslations("billing.simulator");
  return (
    <p
      role="note"
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
    >
      {t("banner")}
    </p>
  );
}
