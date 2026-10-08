import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Card } from "@/components/card";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { billingMode } from "@/lib/billing/config";
import { getEntitlements } from "@/lib/billing/server";
import { getCurrentSimulatedSubscription } from "@/lib/billing/simulator-server";
import { simulatedPortalAction } from "../actions";
import { SimulatedBanner } from "../test-mode";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing.simulator");
  return { title: t("portal.title"), robots: { index: false } };
}

const PORTAL_ACTIONS = ["cancelAtPeriodEnd", "resume", "cancelNow", "payOutstanding"] as const;
type PortalAction = (typeof PORTAL_ACTIONS)[number];
const isPortalAction = (value: string | undefined): value is PortalAction =>
  (PORTAL_ACTIONS as readonly string[]).includes(value ?? "");

/**
 * Gestion de l'abonnement simulée (remplace le portail client Stripe en phase
 * de test). Ne montre et n'agit que sur l'abonnement de l'utilisateur connecté.
 */
export default async function SimulatedPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ fait?: string; erreur?: string }>;
}) {
  if (billingMode() !== "simulator") notFound();
  const user = await requireUser();
  // Droits d'abord : ils appliquent une échéance passée.
  await getEntitlements(user.id);
  const [t, format, sub, query] = await Promise.all([
    getTranslations("billing.simulator"),
    getFormatter(),
    getCurrentSimulatedSubscription(user.id),
    searchParams,
  ]);
  const periodEnd = sub?.currentPeriodEnd ? format.dateTime(sub.currentPeriodEnd, "short") : null;
  const active = sub?.status === "ACTIVE" || sub?.status === "TRIALING";
  const available: PortalAction[] = !sub
    ? []
    : sub.status === "PAST_DUE"
      ? ["payOutstanding", "cancelNow"]
      : active && sub.cancelAtPeriodEnd
        ? ["resume", "cancelNow"]
        : active
          ? ["cancelAtPeriodEnd", "cancelNow"]
          : [];

  return (
    <div className="mx-auto max-w-2xl">
      <SimulatedBanner />
      <PageHeader title={t("portal.title")} />

      {isPortalAction(query.fait) ? (
        <p
          role="status"
          className="border-brand-line bg-brand-soft text-brand-ink mb-6 rounded-2xl border px-4 py-3"
        >
          {t(`portal.done.${query.fait}`)}
        </p>
      ) : null}
      {query.erreur ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink mb-6 rounded-2xl border px-4 py-3"
        >
          {t("portal.error")}
        </p>
      ) : null}

      <Card>
        {sub ? (
          <>
            <p className="text-lg font-semibold">
              {t(`portal.status.${sub.status as "ACTIVE" | "TRIALING" | "PAST_DUE"}`)}
            </p>
            {periodEnd ? (
              <p className="text-ink-muted mt-1">
                {sub.cancelAtPeriodEnd
                  ? t("portal.endsOn", { date: periodEnd })
                  : sub.status === "PAST_DUE"
                    ? t("portal.retryUntil", { date: periodEnd })
                    : t("portal.renewsOn", { date: periodEnd })}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-ink-muted">{t("portal.none")}</p>
        )}

        {available.length > 0 ? (
          <form
            action={simulatedPortalAction}
            className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap"
          >
            {available.map((action, i) => (
              <button
                key={action}
                type="submit"
                name="action"
                value={action}
                className={`${buttonClass(i === 0 ? "primary" : "secondary")} w-full sm:w-auto`}
              >
                {t(`portal.actions.${action}`)}
              </button>
            ))}
          </form>
        ) : null}
      </Card>

      <p className="mt-6">
        <Link
          href="/app/billing"
          className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
        >
          <Icon name="arrow" className="size-4 rotate-180" />
          {t("back")}
        </Link>
      </p>
    </div>
  );
}
