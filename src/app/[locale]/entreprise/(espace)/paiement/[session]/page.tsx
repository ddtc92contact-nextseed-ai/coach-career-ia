import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { billingMode } from "@/lib/billing/config";
import { getSimulatedJobPostingCheckout } from "@/lib/billing/simulator-server";
import { postingDurationDays } from "@/lib/employer/config";
import { requireEmployer } from "@/lib/employer/session";
import { SimulatedBanner } from "../../../../app/billing/simulation/test-mode";
import { BackLink } from "../../parts";
import { completeSimulatedPostingCheckout } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.checkout");
  return { title: t("title"), robots: { index: false } };
}

/**
 * Page de paiement simulée d'une publication (remplace Stripe Checkout en
 * phase de test) : aucun champ de carte. Réservée au membre qui l'a ouverte.
 */
export default async function SimulatedPostingCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ session: string }>;
  searchParams: Promise<{ refus?: string }>;
}) {
  if (billingMode() !== "simulator") notFound();
  const { user } = await requireEmployer();
  const [{ session }, query] = await Promise.all([params, searchParams]);
  const checkout = await getSimulatedJobPostingCheckout(user.id, session);
  if (!checkout) notFound();

  const [t, ts, format] = await Promise.all([
    getTranslations("employer.checkout"),
    getTranslations("billing.simulator"),
    getFormatter(),
  ]);
  const amount = format.number(checkout.amountCents / 100, {
    style: "currency",
    currency: checkout.currency,
  });

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/entreprise/offres/${checkout.postingId}`}>{t("back")}</BackLink>
      <SimulatedBanner />
      <PageHeader title={t("title")} lead={ts("checkout.intro")} />

      {query.refus ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink mb-6 rounded-2xl border px-5 py-4 font-medium"
        >
          {ts("checkout.declined")}
        </p>
      ) : null}

      <Card>
        <dl className="divide-line divide-y">
          <div className="flex justify-between gap-4 pb-4">
            <dt className="text-ink-muted">{t("offer")}</dt>
            <dd className="min-w-0 text-right font-semibold break-words">
              {checkout.posting.offer.title}
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-4">
            <dt className="text-ink-muted">{t("duration")}</dt>
            <dd className="font-semibold">{t("days", { days: postingDurationDays() })}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 pt-4">
            <dt className="text-ink-muted">{t("total")}</dt>
            <dd className="font-display text-3xl font-bold tabular-nums">{amount}</dd>
          </div>
        </dl>
      </Card>

      <form
        action={completeSimulatedPostingCheckout}
        className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap"
      >
        <input type="hidden" name="session" value={session} />
        <button
          type="submit"
          name="outcome"
          value="success"
          className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}
        >
          {ts("checkout.pay")}
        </button>
        <button
          type="submit"
          name="outcome"
          value="declined"
          className={`${buttonClass("secondary", "lg")} w-full sm:w-auto`}
        >
          {ts("checkout.decline")}
        </button>
        <button
          type="submit"
          name="outcome"
          value="cancel"
          className={`${buttonClass("ghost", "lg")} w-full sm:w-auto`}
        >
          {ts("checkout.cancel")}
        </button>
      </form>
      <p className="text-ink-muted mt-6 text-sm">{ts("checkout.noCard")}</p>
    </div>
  );
}
