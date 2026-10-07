import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
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

const button = "w-full rounded-lg px-5 py-2.5 text-sm font-medium sm:w-auto";

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
    <div className="mx-auto max-w-lg">
      <SimulatedBanner />
      <h1 className="text-2xl font-semibold tracking-tight">{t("checkout.title")}</h1>
      <p className="mt-2 text-stone-600">{t("checkout.intro")}</p>

      {query.refus ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {t("checkout.declined")}
        </p>
      ) : null}

      <dl className="mt-6 divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white text-sm">
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-stone-500">{t("checkout.plan")}</dt>
          <dd className="font-medium">{tb("plans.PREMIUM.name")}</dd>
        </div>
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-stone-500">{t("checkout.total")}</dt>
          <dd className="font-medium">
            {tb("price", { price: amount, interval: price.interval })}
          </dd>
        </div>
      </dl>

      <form action={completeSimulatedCheckout} className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input type="hidden" name="session" value={session} />
        <button
          type="submit"
          name="outcome"
          value="success"
          className={`${button} bg-stone-900 text-white hover:bg-stone-700`}
        >
          {t("checkout.pay")}
        </button>
        <button
          type="submit"
          name="outcome"
          value="declined"
          className={`${button} border border-stone-300 bg-white hover:bg-stone-100`}
        >
          {t("checkout.decline")}
        </button>
        <button
          type="submit"
          name="outcome"
          value="cancel"
          className={`${button} text-stone-600 hover:bg-stone-100`}
        >
          {t("checkout.cancel")}
        </button>
      </form>
      <p className="mt-6 text-xs text-stone-500">{t("checkout.noCard")}</p>
      <p className="mt-4 text-sm">
        <Link href="/app/billing" className="text-stone-600 underline hover:text-stone-900">
          {t("back")}
        </Link>
      </p>
    </div>
  );
}
