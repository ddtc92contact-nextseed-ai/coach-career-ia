import { useTranslations } from "next-intl";
import { Badge } from "@/components/badge";

/** Pastille « Mode test » : le simulateur de paiement est actif. */
export function TestModeBadge() {
  const t = useTranslations("billing.simulator");
  return (
    <p className="flex flex-col items-start gap-1 sm:items-end">
      <Badge tone="warning">{t("badge")}</Badge>
      <span className="text-ink-subtle text-xs">{t("badgeHint")}</span>
    </p>
  );
}

/** Bandeau des pages simulées (paiement, gestion de l'abonnement). */
export function SimulatedBanner() {
  const t = useTranslations("billing.simulator");
  return (
    <p
      role="note"
      className="border-warning-line bg-warning-soft text-warning-ink mb-6 rounded-lg border px-4 py-3 text-sm font-medium"
    >
      {t("banner")}
    </p>
  );
}
