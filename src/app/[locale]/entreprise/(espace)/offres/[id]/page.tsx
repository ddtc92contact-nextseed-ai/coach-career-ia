import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { Card } from "@/components/card";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { isAdminEmail } from "@/lib/auth/admin-emails";
import { billingMode } from "@/lib/billing/config";
import { jobPostingPriceFromEnv, postingDurationDays } from "@/lib/employer/config";
import { countryNames } from "@/lib/employer/countries";
import { canPay, displayStatus, isEditable } from "@/lib/employer/lifecycle";
import { getPosting } from "@/lib/employer/repository";
import { requireEmployer } from "@/lib/employer/session";
import { TestModeBadge } from "../../../../app/billing/simulation/test-mode";
import {
  BackLink,
  Notice,
  OrganizationNotice,
  PostingProgress,
  PostingStatusBadge,
} from "../../parts";
import { PendingButton } from "../../pending-button";
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
  const shown = displayStatus(posting);
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
    <div className="max-w-4xl">
      <BackLink href="/entreprise">{t("back")}</BackLink>
      <OrganizationNotice org={org} />
      {query.paiement === "ok" ? <Notice tone="info">{t("notice.paid")}</Notice> : null}
      {query.paiement === "annule" ? <Notice tone="info">{t("notice.canceled")}</Notice> : null}
      {done ? <Notice tone="info">{t(`notice.${done}`)}</Notice> : null}
      {error ? <Notice tone="error">{t(`errors.${error}`)}</Notice> : null}

      <PageHeader title={offer.title} lead={t("views", { count: posting.viewCount })}>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <PostingStatusBadge status={shown} />
          {status === "LIVE" && posting.expiresAt ? (
            <span className="text-ink-muted">
              {t("liveUntil", { date: format.dateTime(posting.expiresAt, "short") })}
            </span>
          ) : null}
        </div>
        <PostingProgress status={shown} />
      </PageHeader>

      <Card
        tone={status === "LIVE" ? "brand" : "default"}
        aria-label={t(`help.${status}`)}
        className="mb-8"
      >
        <p className="text-lg text-pretty">{t(`help.${status}`)}</p>
        {status === "IN_REVIEW" && org.status === "PENDING" ? (
          <p className="text-warning-ink mt-2">{t("reviewPendingOrg")}</p>
        ) : null}
        {posting.flags.length > 0 && (status === "IN_REVIEW" || status === "AWAITING_PAYMENT") ? (
          <p className="text-warning-ink mt-2">{t("flagged")}</p>
        ) : null}
        {status === "REJECTED" && posting.reviewNote ? (
          <p className="border-danger-line bg-danger-soft text-danger-ink mt-3 rounded-xl border px-4 py-3">
            {t("rejectedReason", { reason: posting.reviewNote })}
          </p>
        ) : null}
        {payable ? (
          <p className="text-ink-muted mt-3">{t("price", { days, price: priceLabel })}</p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {status === "DRAFT" ? (
            <form action={submitPostingAction.bind(null, posting.id)}>
              <PendingButton label={t("actions.submit")} variant="primary" />
            </form>
          ) : null}
          {payable ? (
            <form action={payPostingAction.bind(null, posting.id)}>
              <PendingButton
                label={status === "LIVE" ? t("actions.extend", { days }) : t("actions.pay")}
                variant={status === "LIVE" ? "secondary" : "primary"}
              />
            </form>
          ) : null}
          {payable && status !== "LIVE" && isAdminEmail(user.email) ? (
            <form action={adminPublishAction.bind(null, posting.id)}>
              <PendingButton label={t("actions.adminFree")} />
            </form>
          ) : null}
          {status === "CLOSED" && org.status !== "SUSPENDED" ? (
            <form action={renewPostingAction.bind(null, posting.id)}>
              <PendingButton label={t("actions.renew")} variant="primary" />
            </form>
          ) : null}
          {status === "LIVE" ? (
            <form action={closePostingAction.bind(null, posting.id)}>
              <button
                type="submit"
                className={`${buttonClass("secondary", "lg")} w-full sm:w-auto`}
              >
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
        </div>
        {payable && billingMode() === "simulator" ? (
          <div className="mt-5">
            <TestModeBadge />
          </div>
        ) : null}
      </Card>

      {isEditable(status) ? (
        <PostingForm
          action={updatePostingAction.bind(null, posting.id)}
          initial={initial}
          submitLabel={t("save")}
          countryNames={countryNames(locale)}
        />
      ) : (
        <Card>
          <p className="text-ink-muted max-w-[70ch] whitespace-pre-line">{offer.description}</p>
        </Card>
      )}
    </div>
  );
}
