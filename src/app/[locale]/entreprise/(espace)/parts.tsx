import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import type { PostingStatus } from "@/lib/employer/lifecycle";
import type { Organization } from "@/lib/employer/repository";

const TONE: Record<PostingStatus, "neutral" | "proven" | "warning"> = {
  DRAFT: "neutral",
  AWAITING_PAYMENT: "warning",
  IN_REVIEW: "warning",
  LIVE: "proven",
  CLOSED: "neutral",
  REJECTED: "warning",
};

export async function PostingStatusBadge({ status }: { status: PostingStatus }) {
  const t = await getTranslations("employer.status");
  return <Badge tone={TONE[status]}>{t(status)}</Badge>;
}

/** Bandeau d'une organisation en attente de validation ou suspendue. */
export async function OrganizationNotice({ org }: { org: Organization }) {
  if (org.status === "ACTIVE") return null;
  const t = await getTranslations("employer.org");
  const pending = org.status === "PENDING";
  return (
    <div
      role="status"
      className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
        pending
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      <p className="font-medium">{pending ? t("pendingTitle") : t("suspendedTitle")}</p>
      <p className="mt-1">{pending ? t("pendingText") : t("suspendedText")}</p>
      {org.reviewNote ? <p className="mt-1">{t("reason", { reason: org.reviewNote })}</p> : null}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
        tone === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-brand-100 bg-brand-50 text-brand-900"
      }`}
    >
      {children}
    </p>
  );
}
