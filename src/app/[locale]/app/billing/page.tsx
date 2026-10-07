import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";
import { isBillingConfigured } from "@/lib/billing/config";
import { getBillingAccount } from "@/lib/billing/repository";
import { getEntitlements, getPremiumPrice } from "@/lib/billing/server";
import { coachMessagesPerDay } from "@/lib/coach/quota";
import { openPortal, startCheckout } from "./actions";
import { RedirectButton } from "./redirect-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing");
  return { title: t("title") };
}

const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warn" | "error";
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-brand-100 bg-brand-50 text-brand-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mb-6 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}
    >
      {children}
    </p>
  );
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; error?: string }>;
}) {
  const user = await requireUser();
  const configured = isBillingConfigured();
  const [t, format, entitlements, account, price, query] = await Promise.all([
    getTranslations("billing"),
    getFormatter(),
    getEntitlements(user.id),
    getBillingAccount(user.id),
    configured ? getPremiumPrice() : Promise.resolve(null),
    searchParams,
  ]);
  const premium = entitlements.plan === "PREMIUM";
  const freeLimit = coachMessagesPerDay();
  const priceLabel = price
    ? t("price", {
        price: format.number(price.amount, { style: "currency", currency: price.currency }),
        interval: price.interval,
      })
    : null;
  const periodEnd = account?.currentPeriodEnd
    ? format.dateTime(account.currentPeriodEnd, "short")
    : null;
  const canManage = configured && Boolean(account?.stripeCustomerId);

  return (
    <div className="max-w-3xl space-y-6">
      <PageTitle title={t("title")} intro={t("intro")} />

      {query.checkout === "success" ? <Notice tone="info">{t("checkoutSuccess")}</Notice> : null}
      {query.checkout === "cancel" ? <Notice tone="warn">{t("checkoutCancel")}</Notice> : null}
      {query.error === "checkout" || query.error === "portal" ? (
        <Notice tone="error">{t(`errors.${query.error}`)}</Notice>
      ) : null}
      {!configured ? <Notice tone="warn">{t("notAvailable")}</Notice> : null}

      <section className={sectionClass} aria-labelledby="offre-actuelle">
        <h2 id="offre-actuelle" className="text-sm font-medium text-stone-500">
          {t("current.title")}
        </h2>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {t(`plans.${entitlements.plan}.name`)}
        </p>
        <div className="mt-2 space-y-1 text-sm text-stone-600">
          {entitlements.source === "admin" ? <p>{t("current.admin")}</p> : null}
          {entitlements.source === "subscription" && periodEnd ? (
            <p>
              {account?.cancelAtPeriodEnd
                ? t("current.endsOn", { date: periodEnd })
                : t("current.renewsOn", { date: periodEnd })}
            </p>
          ) : null}
          {entitlements.source === "free" ? <p>{t("current.free", { limit: freeLimit })}</p> : null}
        </div>
        {account?.subscriptionStatus === "PAST_DUE" ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {t("current.pastDue")}
          </p>
        ) : null}
        {canManage ? (
          <form action={openPortal} className="mt-4">
            <RedirectButton label={t("manage")} pendingLabel={t("redirecting")} />
            <p className="mt-2 text-xs text-stone-500">{t("manageHint")}</p>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="offres">
        <h2 id="offres" className="mb-3 text-lg font-semibold">
          {t("compare.title")}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          <li className={sectionClass}>
            <h3 className="font-semibold">{t("plans.FREE.name")}</h3>
            <p className="mt-1 text-sm text-stone-500">{t("plans.FREE.price")}</p>
            <ul className="mt-4 space-y-2 text-sm text-stone-700">
              <li>✓ {t("features.memory")}</li>
              <li>✓ {t("features.opportunities")}</li>
              <li>
                ✓{" "}
                {freeLimit === 0
                  ? t("features.coachNone")
                  : t("features.coachLimited", { limit: freeLimit })}
              </li>
            </ul>
          </li>
          <li className={`${sectionClass} border-stone-900`}>
            <h3 className="font-semibold">{t("plans.PREMIUM.name")}</h3>
            <p className="mt-1 text-sm text-stone-500">{priceLabel ?? t("priceUnknown")}</p>
            <ul className="mt-4 space-y-2 text-sm text-stone-700">
              <li>✓ {t("features.everythingFree")}</li>
              <li>✓ {t("features.coachUnlimited")}</li>
            </ul>
            {!premium && configured ? (
              <form action={startCheckout} className="mt-5">
                <RedirectButton primary label={t("upgrade")} pendingLabel={t("redirecting")} />
                <p className="mt-2 text-xs text-stone-500">{t("upgradeHint")}</p>
              </form>
            ) : null}
          </li>
        </ul>
      </section>

      <p className="text-xs text-stone-500">{t("privacy")}</p>
    </div>
  );
}
