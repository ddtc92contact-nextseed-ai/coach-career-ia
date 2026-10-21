"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { Link } from "@/i18n/navigation";

/** Prix mensuel de Premium, lu chez le fournisseur de paiement (simulateur ou Stripe). */
export type UpsellPrice = { amount: number; currency: string; interval: string };

/**
 * Limite gratuite atteinte : un encart d'information (pas une erreur) qui dit
 * quand un message gratuit se libère et, quand le paiement est disponible,
 * ce que Premium débloque, à quel prix, avec un lien vers « Abonnement ».
 */
export function CoachUpsell({
  limit,
  billing,
  price = null,
  resetAt = null,
}: {
  limit: number;
  billing: boolean;
  price?: UpsellPrice | null;
  /** Instant (ISO) où un message gratuit se libère ; `null` si inconnu. */
  resetAt?: string | null;
}) {
  const t = useTranslations("coach.upsell");
  const tb = useTranslations("billing");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const reset = resetAt ? new Date(resetAt) : null;
  const premiumOnly = limit === 0;

  return (
    <div
      role="status"
      data-tone="night"
      className="band-night on-night border-night-line text-on-night rounded-2xl border p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="bg-night-raised text-signal ring-night-line inline-flex size-11 shrink-0 items-center justify-center rounded-xl ring-1"
        >
          <Icon name="star" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold text-balance">
            {premiumOnly ? t("titlePremiumOnly") : t("title", { limit })}
          </p>
          <p className="text-on-night-muted mt-1 text-pretty">
            {premiumOnly ? t("textPremiumOnly") : t("text", { limit })}
          </p>
          {!premiumOnly && reset && reset > now ? (
            <p className="text-on-night mt-2 flex items-start gap-2 font-medium">
              <Icon name="clock" className="text-signal mt-0.5 size-5 shrink-0" />
              <span suppressHydrationWarning>
                {t("resetsAt", {
                  relative: format.relativeTime(reset, now),
                  time: format.dateTime(reset, { hour: "2-digit", minute: "2-digit" }),
                })}
              </span>
            </p>
          ) : null}
          {!billing ? <p className="text-on-night-muted mt-2">{t("later")}</p> : null}
        </div>
      </div>

      {billing ? (
        <div className="border-night-line mt-5 flex flex-col gap-5 border-t pt-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold">{t("unlocks")}</p>
            <ul className="mt-2 space-y-2">
              {(["coachUnlimited", "negotiation"] as const).map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Icon name="check" className="text-signal mt-0.5 size-5 shrink-0" />
                  <span className="min-w-0">{tb(`features.${feature}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {price ? (
              <p className="font-display text-2xl font-bold tabular-nums">
                {tb("price", {
                  price: format.number(price.amount, {
                    style: "currency",
                    currency: price.currency,
                  }),
                  interval: price.interval,
                })}
              </p>
            ) : null}
            <Link href="/app/billing" className={buttonClass("signal")}>
              {t("cta")}
              <Icon name="arrow" className="size-4" />
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
