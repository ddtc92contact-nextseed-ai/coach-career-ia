import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { SIGN_UP_PATH } from "@/config/routes";
import { Link } from "@/i18n/navigation";
import { DEFAULT_SIMULATED_CURRENCY } from "@/lib/billing/config";
import { getBillingProvider } from "@/lib/billing/provider";
import { coachMessagesPerDay } from "@/lib/coach/quota";
import { Section, SECTION_IDS, SectionHeading } from "./sections";

/**
 * Offres Gratuit / Premium. Le prix vient du fournisseur de paiement actif
 * (simulateur ou Stripe, comme la page « Abonnement ») et le quota du coach
 * de sa configuration : rien n'est écrit en dur ici.
 */
export async function Pricing() {
  const provider = getBillingProvider();
  const [t, tb, format, price] = await Promise.all([
    getTranslations("landing.pricing"),
    getTranslations("billing"),
    getFormatter(),
    provider ? provider.getPremiumPrice() : Promise.resolve(null),
  ]);
  const freeLimit = coachMessagesPerDay();
  const currency = price?.currency ?? DEFAULT_SIMULATED_CURRENCY;
  const money = (amount: number) =>
    format.number(amount, {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    });
  const heading = `${SECTION_IDS.pricing}-titre`;

  const plans = [
    {
      key: "FREE",
      amount: money(0),
      period: t("forever"),
      tagline: t("freeTagline"),
      features: [
        tb("features.memory"),
        tb("features.opportunities"),
        t("contact"),
        freeLimit > 0
          ? tb("features.coachLimited", { limit: freeLimit })
          : tb("features.coachNone"),
      ],
      cta: t("freeCta"),
      featured: false,
    },
    {
      key: "PREMIUM",
      amount: price ? money(price.amount) : null,
      period: price ? t("perInterval", { interval: price.interval }) : tb("priceUnknown"),
      tagline: t("premiumTagline"),
      features: [
        tb("features.everythingFree"),
        tb("features.coachUnlimited"),
        tb("features.negotiation"),
      ],
      cta: t("premiumCta"),
      featured: true,
    },
  ] as const;

  return (
    <Section id={SECTION_IDS.pricing} band="surface">
      <SectionHeading
        id={heading}
        align="center"
        eyebrow={t("eyebrow")}
        title={t("title")}
        intro={t("intro")}
      />
      <ul className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-2">
        {plans.map((plan) => {
          // Offre mise en avant : panneau « nuit » ; l'autre sur fond brume.
          const night = plan.featured;
          return (
            <li
              key={plan.key}
              className={`reveal relative flex flex-col rounded-3xl border p-6 sm:p-8 ${
                night
                  ? "band-night on-night text-on-night border-night-line shadow-lg"
                  : "bg-canvas border-line shadow-sm"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-2xl font-bold tracking-tight">
                  {tb(`plans.${plan.key}.name`)}
                </h3>
                {night ? (
                  <span className="bg-signal text-night rounded-full px-3 py-1 text-sm font-semibold">
                    {t("recommended")}
                  </span>
                ) : null}
              </div>
              <p className={`mt-2 ${night ? "text-on-night-muted" : "text-ink-muted"}`}>
                {plan.tagline}
              </p>
              <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
                {plan.amount ? (
                  <span className="font-display text-5xl font-bold tracking-tight tabular-nums">
                    {plan.amount}
                  </span>
                ) : null}
                <span className={night ? "text-on-night-muted" : "text-ink-subtle"}>
                  {plan.period}
                </span>
              </p>
              <ul
                className={`mt-6 flex-1 space-y-3 border-t pt-6 ${night ? "border-night-line" : "border-line"}`}
              >
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3">
                    <Icon
                      name="check"
                      className={`mt-1 size-5 shrink-0 ${night ? "text-signal" : "text-brand-ink"}`}
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={SIGN_UP_PATH}
                className={`${buttonClass(night ? "signal" : "primary", "lg")} mt-8 w-full`}
              >
                {plan.cta}
              </Link>
              {night ? (
                <p className="text-on-night-muted mt-3 text-center text-base">{t("premiumNote")}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
