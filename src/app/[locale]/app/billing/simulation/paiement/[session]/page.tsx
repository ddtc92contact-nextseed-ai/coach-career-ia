import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Card } from "@/components/card";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { billingMode, simulatedPriceFromEnv } from "@/lib/billing/config";
import { getSimulatedCheckout } from "@/lib/billing/simulator-server";
import { completeSimulatedCheckout } from "../../actions";
import { SimulatedBanner } from "../../test-mode";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("billing.simulator");
  return { title: t("checkout.title"), robots: { index: false } };
}

/**
 * Page de paiement simulée (remplace Stripe Checkout en phase de test) :
 * aucun champ de carte, trois issues possibles. Réservée au titulaire de la
 * session (404 sinon).
 */
export default async function SimulatedCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ session: string }>;
  searchParams: Promise<{ refus?: string }>;
}) {
  if (billingMode() !== "simulator") notFound();
  const user = await requireUser();
  const [{ session }, query] = await Promise.all([params, searchParams]);
  const checkout = await getSimulatedCheckout(user.id, session);
  if (!checkout) notFound();

  const [t, tb, format] = await Promise.all([
    getTranslations("billing.simulator"),
    getTranslations("billing"),
    getFormatter(),
  ]);
  const price = simulatedPriceFromEnv();
  const amount = format.number(price.amount, { style: "currency", currency: price.currency });

  return (
    <div className="mx-auto max-w-2xl">
      <SimulatedBanner />
      <PageHeader title={t("checkout.title")} lead={t("checkout.intro")} />

      {query.refus ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink mb-6 rounded-2xl border px-4 py-3"
        >
          {t("checkout.declined")}
        </p>
      ) : null}

      <Card>
        <dl className="divide-line divide-y">
          <div className="flex justify-between gap-4 pb-4">
            <dt className="text-ink-subtle">{t("checkout.plan")}</dt>
            <dd className="font-semibold">{tb("plans.PREMIUM.name")}</dd>
          </div>
          <div className="flex justify-between gap-4 pt-4">
            <dt className="text-ink-subtle">{t("checkout.total")}</dt>
            <dd className="font-display text-xl font-bold">
              {tb("price", { price: amount, interval: price.interval })}
            </dd>
          </div>
        </dl>

        <form
          action={completeSimulatedCheckout}
          className="border-line mt-6 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:flex-wrap"
        >
          <input type="hidden" name="session" value={session} />
          <button
            type="submit"
            name="outcome"
            value="success"
            className={`${buttonClass("primary")} w-full sm:w-auto`}
          >
            {t("checkout.pay")}
          </button>
          <button
            type="submit"
            name="outcome"
            value="declined"
            className={`${buttonClass("secondary")} w-full sm:w-auto`}
          >
            {t("checkout.decline")}
          </button>
          <button
            type="submit"
            name="outcome"
            value="cancel"
            className={`${buttonClass("ghost")} w-full sm:w-auto`}
          >
            {t("checkout.cancel")}
          </button>
        </form>
      </Card>
      <p className="text-ink-subtle mt-6 flex items-start gap-2 text-sm">
        <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
        {t("checkout.noCard")}
      </p>
      <p className="mt-4">
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
