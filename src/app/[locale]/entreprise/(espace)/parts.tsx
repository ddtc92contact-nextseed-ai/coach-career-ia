import { getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/badge";
import { Icon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import type { PostingDisplayStatus, PostingStatus } from "@/lib/employer/lifecycle";
import type { Organization } from "@/lib/employer/repository";

/** Une couleur par statut : brouillon, paiement, vérification, en ligne, fermée, expirée, refusée. */
const TONE: Record<PostingDisplayStatus, BadgeTone> = {
  DRAFT: "neutral",
  AWAITING_PAYMENT: "warning",
  IN_REVIEW: "info",
  LIVE: "proven",
  CLOSED: "neutral",
  EXPIRED: "danger",
  REJECTED: "danger",
};

export async function PostingStatusBadge({
  status,
  size = "md",
}: {
  status: PostingDisplayStatus;
  size?: "sm" | "md";
}) {
  const t = await getTranslations("employer.status");
  return (
    <Badge tone={TONE[status]} size={size} dot>
      {t(status)}
    </Badge>
  );
}

/** Étapes de publication, de la rédaction à la mise en ligne. */
const STEPS = ["DRAFT", "AWAITING_PAYMENT", "IN_REVIEW", "LIVE"] as const satisfies PostingStatus[];

/** Frise des étapes ; masquée pour une offre fermée, expirée ou refusée (le badge suffit). */
export async function PostingProgress({ status }: { status: PostingDisplayStatus }) {
  const current = STEPS.indexOf(status as (typeof STEPS)[number]);
  if (current < 0) return null;
  const [ts, tp] = await Promise.all([
    getTranslations("employer.status"),
    getTranslations("employer.posting"),
  ]);
  return (
    <ol aria-label={tp("progress")} className="mt-6 grid gap-2 sm:grid-cols-4 sm:gap-3">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium ${
              active
                ? "border-brand-line bg-surface text-ink shadow-sm"
                : done
                  ? "text-ink-muted border-transparent"
                  : "border-line text-ink-subtle border-dashed"
            }`}
          >
            <span
              aria-hidden="true"
              className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums ${
                done
                  ? "bg-brand text-on-brand"
                  : active
                    ? "bg-night text-signal"
                    : "bg-muted text-ink-subtle"
              }`}
            >
              {done ? <Icon name="check" className="size-4" strokeWidth={2.5} /> : index + 1}
            </span>
            <span className="min-w-0 text-pretty">{ts(step)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Lien de retour en haut des pages de détail. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-ink-muted hover:text-ink mb-4 inline-flex items-center gap-1.5 rounded-lg text-base font-medium hover:underline hover:underline-offset-4"
    >
      {children}
    </Link>
  );
}

/** Bandeau d'une organisation en attente de validation ou suspendue. */
export async function OrganizationNotice({ org }: { org: Organization }) {
  if (org.status === "ACTIVE") return null;
  const t = await getTranslations("employer.org");
  const pending = org.status === "PENDING";
  return (
    <div
      role="status"
      className={`mb-6 flex gap-3 rounded-2xl border px-5 py-4 ${
        pending
          ? "border-warning-line bg-warning-soft text-warning-ink"
          : "border-danger-line bg-danger-soft text-danger-ink"
      }`}
    >
      <Icon name={pending ? "shield" : "flag"} className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{pending ? t("pendingTitle") : t("suspendedTitle")}</p>
        <p className="mt-1 text-pretty">{pending ? t("pendingText") : t("suspendedText")}</p>
        {org.reviewNote ? <p className="mt-1">{t("reason", { reason: org.reviewNote })}</p> : null}
      </div>
    </div>
  );
}

export function Notice({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mb-6 flex items-start gap-3 rounded-2xl border px-5 py-4 font-medium ${
        tone === "error"
          ? "border-danger-line bg-danger-soft text-danger-ink"
          : "border-brand-line bg-brand-soft text-brand-ink"
      }`}
    >
      <Icon name={tone === "error" ? "flag" : "check"} className="mt-0.5 size-5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
