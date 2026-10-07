import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { DeleteButton } from "@/components/delete-button";
import { Link } from "@/i18n/navigation";
import { isAdminEmail } from "@/lib/auth/admin-emails";
import { billingMode } from "@/lib/billing/config";
import { jobPostingPriceFromEnv, postingDurationDays } from "@/lib/employer/config";
import { countryNames } from "@/lib/employer/countries";
import { canPay, isEditable } from "@/lib/employer/lifecycle";
import { getPosting } from "@/lib/employer/repository";
import { requireEmployer } from "@/lib/employer/session";
import { RedirectButton } from "../../../../app/billing/redirect-button";
import { TestModeBadge } from "../../../../app/billing/simulation/test-mode";
import { Notice, OrganizationNotice, PostingStatusBadge } from "../../parts";
import {
  adminPublishAction,
  closePostingAction,
  deleteDraftAction,
  payPostingAction,
  renewPostingAction,
  submitPostingAction,
  updatePostingAction,
} from "../actions";
import { PostingForm, type PostingFormValues } from "../posting-form";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fait?: string; erreur?: string; paiement?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.dashboard");
  return { title: t("title") };
}

const DONE = ["submitted", "closed", "renewed", "published"] as const;
const ERRORS = ["notAllowed", "unavailable", "suspended"] as const;
const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";
const secondary =
  "w-full rounded-lg border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-stone-100 sm:w-auto";

const pick = <T extends string>(values: readonly T[], value: string | undefined) =>
  values.find((v) => v === value) ?? null;

/** Offre de l'organisation : statut, paiement, modération, contenu modifiable. 404 sinon. */
export default async function PostingPage({ params, searchParams }: Props) {
  const { user, org } = await requireEmployer();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const posting = await getPosting(org.id, id);
  if (!posting) notFound();

  const [t, format, locale] = await Promise.all([
    getTranslations("employer.posting"),
    getFormatter(),
    getLocale(),
  ]);
  const days = postingDurationDays();
  const price = jobPostingPriceFromEnv();
  const priceLabel = format.number(price.amountCents / 100, {
    style: "currency",
    currency: price.currency,
  });
  const { status, offer } = posting;
  const done = pick(DONE, query.fait);
  const error = pick(ERRORS, query.erreur);
  const payable = canPay(status) && org.status !== "SUSPENDED";
  const initial: PostingFormValues = {
    title: offer.title,
    description: offer.description,
    contractType: offer.contractType,
    remotePolicy: offer.remotePolicy,
    city: offer.city ?? "",
    country: offer.country ?? "FR",
    seniority: offer.seniority ?? "",
    sector: offer.sector ?? "",
    salaryMin: offer.salaryMin?.toString() ?? "",
    salaryMax: offer.salaryMax?.toString() ?? "",
    salaryCurrency: offer.salaryCurrency ?? "EUR",
    salaryPeriod: offer.salaryPeriod ?? "YEAR",
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/entreprise" className="text-sm text-stone-600 hover:underline">
        {t("back")}
      </Link>
      <OrganizationNotice org={org} />
      {query.paiement === "ok" ? <Notice tone="info">{t("notice.paid")}</Notice> : null}
      {query.paiement === "annule" ? <Notice tone="info">{t("notice.canceled")}</Notice> : null}
      {done ? <Notice tone="info">{t(`notice.${done}`)}</Notice> : null}
      {error ? <Notice tone="error">{t(`errors.${error}`)}</Notice> : null}

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <PostingStatusBadge status={status} />
          {status === "LIVE" && posting.expiresAt ? (
            <span className="text-sm text-stone-600">
              {t("liveUntil", { date: format.dateTime(posting.expiresAt, "short") })}
            </span>
          ) : null}
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight break-words">{offer.title}</h1>
        <p className="mt-1 text-sm text-stone-500">{t("views", { count: posting.viewCount })}</p>
      </header>

      <section className={sectionClass} aria-label={t(`help.${status}`)}>
        <p className="text-stone-700">{t(`help.${status}`)}</p>
        {status === "IN_REVIEW" && org.status === "PENDING" ? (
          <p className="mt-2 text-sm text-amber-800">{t("reviewPendingOrg")}</p>
        ) : null}
        {posting.flags.length > 0 && (status === "IN_REVIEW" || status === "AWAITING_PAYMENT") ? (
          <p className="mt-2 text-sm text-amber-800">{t("flagged")}</p>
        ) : null}
        {status === "REJECTED" && posting.reviewNote ? (
          <p className="mt-2 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
            {t("rejectedReason", { reason: posting.reviewNote })}
          </p>
        ) : null}
        {payable ? (
          <p className="mt-3 text-sm text-stone-600">{t("price", { days, price: priceLabel })}</p>
        ) : null}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {status === "DRAFT" ? (
            <form action={submitPostingAction.bind(null, posting.id)}>
              <RedirectButton label={t("actions.submit")} pendingLabel="…" primary />
            </form>
          ) : null}
          {payable ? (
            <form action={payPostingAction.bind(null, posting.id)}>
              <RedirectButton
                label={status === "LIVE" ? t("actions.extend", { days }) : t("actions.pay")}
                pendingLabel="…"
                primary={status !== "LIVE"}
              />
            </form>
          ) : null}
          {payable && isAdminEmail(user.email) ? (
            <form action={adminPublishAction.bind(null, posting.id)}>
              <RedirectButton label={t("actions.adminFree")} pendingLabel="…" />
            </form>
          ) : null}
          {status === "CLOSED" && org.status !== "SUSPENDED" ? (
            <form action={renewPostingAction.bind(null, posting.id)}>
              <RedirectButton label={t("actions.renew")} pendingLabel="…" primary />
            </form>
          ) : null}
          {status === "LIVE" ? (
            <form action={closePostingAction.bind(null, posting.id)}>
              <button type="submit" className={secondary}>
                {t("actions.close")}
              </button>
            </form>
          ) : null}
          {status === "DRAFT" && !posting.publishedAt && !posting.paidAt ? (
            <DeleteButton
              action={deleteDraftAction.bind(null, posting.id)}
              confirmMessage={t("actions.delete")}
              label={t("actions.delete")}
            />
          ) : null}
          {payable && billingMode() === "simulator" ? <TestModeBadge /> : null}
        </div>
      </section>

      {isEditable(status) ? (
        <PostingForm
          action={updatePostingAction.bind(null, posting.id)}
          initial={initial}
          submitLabel={t("save")}
          countryNames={countryNames(locale)}
        />
      ) : (
        <section className={sectionClass}>
          <p className="text-sm whitespace-pre-line text-stone-700">{offer.description}</p>
        </section>
      )}
    </div>
  );
}
