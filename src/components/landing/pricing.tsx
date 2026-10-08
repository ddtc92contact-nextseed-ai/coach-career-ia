import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { SIGN_UP_PATH } from "@/config/routes";
import { Link } from "@/i18n/navigation";
import { DEFAULT_SIMULATED_CURRENCY } from "@/lib/billing/config";
import { getBillingProvider } from "@/lib/billing/provider";
import { coachMessagesPerDay } from "@/lib/coach/quota";
import { SECTION_IDS, SectionHeading } from "./sections";

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
    <section
      id={SECTION_IDS.pricing}
      aria-labelledby={heading}
      className="border-line bg-subtle border-y"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHeading
          id={heading}
          align="center"
          eyebrow={t("eyebrow")}
          title={t("title")}
          intro={t("intro")}
        />
        <ul className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-2">
          {plans.map((plan) => (
            <li
              key={plan.key}
              className={`reveal bg-surface relative flex flex-col rounded-3xl border p-6 sm:p-8 ${
                plan.featured
                  ? "border-primary ring-primary shadow-lg ring-1"
                  : "border-line shadow-sm"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-xl font-bold tracking-tight">
                  {tb(`plans.${plan.key}.name`)}
                </h3>
                {plan.featured ? (
                  <span className="bg-brand-soft text-brand-ink rounded-full px-3 py-1 text-xs font-semibold">
                    {t("recommended")}
                  </span>
                ) : null}
              </div>
              <p className="text-ink-muted mt-2">{plan.tagline}</p>
              <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
                {plan.amount ? (
                  <span className="font-display text-4xl font-bold tracking-tight tabular-nums">
                    {plan.amount}
                  </span>
                ) : null}
                <span className="text-ink-subtle">{plan.period}</span>
              </p>
              <ul className="border-line mt-6 flex-1 space-y-3 border-t pt-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3">
                    <Icon name="check" className="text-brand-ink mt-0.5 size-5 shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={SIGN_UP_PATH}
                className={`${buttonClass(plan.featured ? "primary" : "secondary", "lg")} mt-8 w-full`}
              >
                {plan.cta}
              </Link>
              {plan.featured ? (
                <p className="text-ink-subtle mt-3 text-center text-sm">{t("premiumNote")}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
