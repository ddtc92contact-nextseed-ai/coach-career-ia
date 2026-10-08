import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { Card, CardHeader } from "@/components/card";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { getBillingProvider } from "@/lib/billing/provider";
import { getBillingAccount } from "@/lib/billing/repository";
import { getEntitlements } from "@/lib/billing/server";
import { coachMessagesPerDay } from "@/lib/coach/quota";
import { openPortal, startCheckout } from "../actions";
import { RedirectButton } from "../redirect-button";
import { TestModeBadge } from "../simulation/test-mode";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing");
  return { title: t("title") };
}

const NOTICE_ICONS: Record<"info" | "warn" | "error", IconName> = {
  info: "approve",
  warn: "info",
  error: "alert",
};

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="bg-brand-soft text-brand-ink in-data-[tone=night]:bg-night-raised in-data-[tone=night]:text-signal mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full"
      >
        <Icon name="check" className="size-3.5" strokeWidth={2.5} />
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warn" | "error";
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-brand-line bg-brand-soft text-brand-ink",
    warn: "border-warning-line bg-warning-soft text-warning-ink",
    error: "border-danger-line bg-danger-soft text-danger-ink",
  };
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 ${tones[tone]}`}
    >
      <Icon name={NOTICE_ICONS[tone]} className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; error?: string }>;
}) {
  const user = await requireUser();
  const provider = getBillingProvider();
  const configured = provider !== null;
  const simulator = provider?.name === "simulator";
  // Droits d'abord : ils appliquent une échéance passée du simulateur.
  const entitlements = await getEntitlements(user.id);
  const [t, format, account, price, query] = await Promise.all([
    getTranslations("billing"),
    getFormatter(),
    getBillingAccount(user.id),
    provider ? provider.getPremiumPrice() : Promise.resolve(null),
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
  const canManage = Boolean(provider && account && provider.canManage(account));
  const hint = (key: "upgradeHint" | "manageHint" | "privacy" | "checkoutSuccess") =>
    t(simulator ? `simulator.${key}` : key);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t("title")}
        lead={t("intro")}
        band="brand"
        actions={simulator ? <TestModeBadge /> : undefined}
      />

      {query.checkout === "success" ? <Notice tone="info">{hint("checkoutSuccess")}</Notice> : null}
      {query.checkout === "cancel" ? <Notice tone="warn">{t("checkoutCancel")}</Notice> : null}
      {query.error === "checkout" || query.error === "portal" ? (
        <Notice tone="error">{t(`errors.${query.error}`)}</Notice>
      ) : null}
      {!configured ? <Notice tone="warn">{t("notAvailable")}</Notice> : null}

      <Card aria-labelledby="offre-actuelle" className="mb-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span
              aria-hidden="true"
              className={`inline-flex size-12 shrink-0 items-center justify-center rounded-2xl ${
                premium ? "bg-night text-signal" : "bg-brand-soft text-brand-ink"
              }`}
            >
              <Icon name={premium ? "star" : "wallet"} className="size-6" />
            </span>
            <div className="min-w-0">
              <h2
                id="offre-actuelle"
                className="text-ink-subtle text-sm font-semibold tracking-wide uppercase"
              >
                {t("current.title")}
              </h2>
              <p className="font-display mt-1 text-3xl font-bold tracking-tight">
                {t(`plans.${entitlements.plan}.name`)}
              </p>
              <div className="text-ink-muted mt-2 space-y-1">
                {entitlements.source === "admin" ? <p>{t("current.admin")}</p> : null}
                {entitlements.source === "subscription" && periodEnd ? (
                  <p>
                    {account?.cancelAtPeriodEnd
                      ? t("current.endsOn", { date: periodEnd })
                      : t("current.renewsOn", { date: periodEnd })}
                  </p>
                ) : null}
                {entitlements.source === "free" ? (
                  <p>{t("current.free", { limit: freeLimit })}</p>
                ) : null}
              </div>
            </div>
          </div>
          {canManage ? (
            <form action={openPortal} className="shrink-0 sm:text-right">
              <RedirectButton label={t("manage")} pendingLabel={t("redirecting")} />
              <p className="text-ink-subtle mt-2 max-w-xs text-sm">{hint("manageHint")}</p>
            </form>
          ) : null}
        </div>
        {!premium && account?.subscriptionStatus === "UNPAID" ? (
          <p
            role="alert"
            className="border-danger-line bg-danger-soft text-danger-ink mt-5 flex items-start gap-3 rounded-xl border px-4 py-3"
          >
            <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
            {t("current.unpaid")}
          </p>
        ) : null}
        {account?.subscriptionStatus === "PAST_DUE" ? (
          <p
            role="alert"
            className="border-warning-line bg-warning-soft text-warning-ink mt-5 flex items-start gap-3 rounded-xl border px-4 py-3"
          >
            <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
            {t("current.pastDue")}
          </p>
        ) : null}
      </Card>

      <section aria-labelledby="offres">
        <h2
          id="offres"
          className="font-display mb-4 text-xl font-bold tracking-tight text-balance sm:text-2xl"
        >
          {t("compare.title")}
        </h2>
        <ul className="grid gap-5 md:grid-cols-2">
          <li>
            <Card as="article" aria-labelledby="offre-gratuite" className="flex h-full flex-col">
              <CardHeader
                id="offre-gratuite"
                as="h3"
                title={
                  <span className="font-display text-2xl font-bold">{t("plans.FREE.name")}</span>
                }
                actions={!premium ? <Badge tone="proven">{t("compare.current")}</Badge> : null}
              />
              <p className="text-ink-muted mt-1">{t("plans.FREE.price")}</p>
              <ul className="mt-6 flex-1 space-y-3">
                <Feature>{t("features.memory")}</Feature>
                <Feature>{t("features.opportunities")}</Feature>
                <Feature>
                  {freeLimit === 0
                    ? t("features.coachNone")
                    : t("features.coachLimited", { limit: freeLimit })}
                </Feature>
              </ul>
            </Card>
          </li>
          <li>
            <Card
              as="article"
              tone="night"
              aria-labelledby="offre-premium"
              className="flex h-full flex-col shadow-lg"
            >
              <CardHeader
                id="offre-premium"
                as="h3"
                title={
                  <span className="font-display inline-flex items-center gap-2 text-2xl font-bold">
                    <Icon name="star" className="text-signal size-6" />
                    {t("plans.PREMIUM.name")}
                  </span>
                }
                actions={
                  premium ? (
                    <span className="bg-signal text-night inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold">
                      {t("compare.current")}
                    </span>
                  ) : null
                }
              />
              <p className="text-on-night-muted mt-1">{priceLabel ?? t("priceUnknown")}</p>
              <ul className="mt-6 flex-1 space-y-3">
                <Feature>{t("features.everythingFree")}</Feature>
                <Feature>{t("features.coachUnlimited")}</Feature>
                <Feature>{t("features.negotiation")}</Feature>
              </ul>
              {!premium && configured ? (
                <form action={startCheckout} className="mt-7">
                  <RedirectButton signal label={t("upgrade")} pendingLabel={t("redirecting")} />
                  <p className="text-on-night-muted mt-2 text-sm">{hint("upgradeHint")}</p>
                </form>
              ) : null}
            </Card>
          </li>
        </ul>
      </section>

      <p className="text-ink-subtle mt-8 flex items-start gap-2 text-sm">
        <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
        {hint("privacy")}
      </p>
    </div>
  );
}
