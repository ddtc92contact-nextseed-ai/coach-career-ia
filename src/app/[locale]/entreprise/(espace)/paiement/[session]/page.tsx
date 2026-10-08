import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { billingMode } from "@/lib/billing/config";
import { getSimulatedJobPostingCheckout } from "@/lib/billing/simulator-server";
import { postingDurationDays } from "@/lib/employer/config";
import { requireEmployer } from "@/lib/employer/session";
import { SimulatedBanner } from "../../../../app/billing/simulation/test-mode";
import { completeSimulatedPostingCheckout } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.checkout");
  return { title: t("title"), robots: { index: false } };
}

const button = "w-full rounded-lg px-5 py-2.5 text-sm font-medium sm:w-auto";

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
    <div className="mx-auto max-w-lg">
      <SimulatedBanner />
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-ink-muted mt-2">{ts("checkout.intro")}</p>

      {query.refus ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink mt-6 rounded-lg border px-4 py-3 text-sm"
        >
          {ts("checkout.declined")}
        </p>
      ) : null}

      <dl className="divide-line border-line bg-surface mt-6 divide-y rounded-2xl border text-sm">
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-ink-subtle">{t("offer")}</dt>
          <dd className="text-right font-medium break-words">{checkout.posting.offer.title}</dd>
        </div>
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-ink-subtle">{t("duration")}</dt>
          <dd className="font-medium">{t("days", { days: postingDurationDays() })}</dd>
        </div>
        <div className="flex justify-between gap-4 p-4">
          <dt className="text-ink-subtle">{t("total")}</dt>
          <dd className="font-medium">{amount}</dd>
        </div>
      </dl>

      <form
        action={completeSimulatedPostingCheckout}
        className="mt-6 flex flex-col gap-3 sm:flex-row"
      >
        <input type="hidden" name="session" value={session} />
        <button
          type="submit"
          name="outcome"
          value="success"
          className={`${button} bg-primary text-on-primary hover:bg-primary-hover`}
        >
          {ts("checkout.pay")}
        </button>
        <button
          type="submit"
          name="outcome"
          value="declined"
          className={`${button} border-line-strong bg-surface hover:bg-muted border`}
        >
          {ts("checkout.decline")}
        </button>
        <button
          type="submit"
          name="outcome"
          value="cancel"
          className={`${button} text-ink-muted hover:bg-muted`}
        >
          {ts("checkout.cancel")}
        </button>
      </form>
      <p className="text-ink-subtle mt-6 text-xs">{ts("checkout.noCard")}</p>
      <p className="mt-4 text-sm">
        <Link
          href={`/entreprise/offres/${checkout.postingId}`}
          className="text-ink-muted hover:text-ink underline"
        >
          {t("back")}
        </Link>
      </p>
    </div>
  );
}
