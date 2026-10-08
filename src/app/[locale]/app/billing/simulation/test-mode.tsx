import { useTranslations } from "next-intl";
import { Badge } from "@/components/badge";
import { Icon } from "@/components/icons";

/** Pastille « Mode test » : le simulateur de paiement est actif. */
export function TestModeBadge() {
  const t = useTranslations("billing.simulator");
  return (
    <p className="flex flex-col items-start gap-1 sm:items-end">
      <Badge tone="warning" icon="flask">
        {t("badge")}
      </Badge>
      <span className="text-ink-muted text-sm">{t("badgeHint")}</span>
    </p>
  );
}

/** Bandeau des pages simulées (paiement, gestion de l'abonnement). */
export function SimulatedBanner() {
  const t = useTranslations("billing.simulator");
  return (
    <p
      role="note"
      className="border-warning-line bg-warning-soft text-warning-ink mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 font-medium"
    >
      <Icon name="flask" className="mt-0.5 size-5 shrink-0" />
      {t("banner")}
    </p>
  );
}
