import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Link } from "@/i18n/navigation";
import { postingDurationDays } from "@/lib/employer/config";
import { displayStatus } from "@/lib/employer/lifecycle";
import { listPostings } from "@/lib/employer/repository";
import { requireEmployer } from "@/lib/employer/session";
import { OrganizationNotice, PostingStatusBadge } from "./parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.dashboard");
  return { title: t("title") };
}

/**
 * Tableau de bord entreprise : les offres de l'organisation, leur statut,
 * leur échéance et un nombre de consultations. AUCUNE donnée candidat.
 */
export default async function EmployerDashboardPage() {
  const { org } = await requireEmployer();
  const [t, tp, format, postings] = await Promise.all([
    getTranslations("employer.dashboard"),
    getTranslations("employer.posting"),
    getFormatter(),
    listPostings(org.id),
  ]);
  const rows = postings.map((posting) => ({ ...posting, shown: displayStatus(posting) }));
  const count = (...statuses: string[]) => rows.filter((r) => statuses.includes(r.shown)).length;
  const stats = [
    { key: "live", icon: "radar", value: count("LIVE") },
    { key: "pending", icon: "wallet", value: count("AWAITING_PAYMENT", "IN_REVIEW") },
    { key: "drafts", icon: "briefcase", value: count("DRAFT", "REJECTED") },
    { key: "views", icon: "target", value: rows.reduce((sum, r) => sum + r.viewCount, 0) },
  ] as const satisfies readonly { key: string; icon: IconName; value: number }[];
  const newLink = (
    <Link href="/entreprise/offres/nouvelle" className={buttonClass("primary", "lg")}>
      <Icon name="plus" className="size-5" />
      {t("newPosting")}
    </Link>
  );

  return (
    <div>
      <OrganizationNotice org={org} />
      <PageHeader
        band="brand"
        eyebrow={org.name}
        title={t("title")}
        lead={t("intro", { days: postingDurationDays() })}
        actions={rows.length > 0 ? newLink : undefined}
      >
        {rows.length > 0 ? (
          <dl className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.key}
                className="border-brand-line bg-surface flex min-w-0 items-center gap-3 rounded-2xl border px-4 py-3 shadow-xs"
              >
                <span className="bg-night text-signal grid size-10 shrink-0 place-items-center rounded-xl max-sm:hidden">
                  <Icon name={stat.icon} className="size-5" />
                </span>
                <div className="min-w-0">
                  <dt className="text-ink-muted text-sm leading-snug break-words hyphens-auto">
                    {t(`stats.${stat.key}`)}
                  </dt>
                  <dd className="font-display text-2xl font-bold tabular-nums">
                    {format.number(stat.value)}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        ) : null}
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState title={t("emptyTitle")} text={t("emptyText")} action={newLink} />
      ) : (
        <ul aria-label={t("title")} className="space-y-3">
          {rows.map((posting) => (
            <li key={posting.id}>
              <Link
                href={`/entreprise/offres/${posting.id}`}
                className="group border-line bg-surface hover:border-line-strong flex flex-col gap-4 rounded-2xl border p-5 shadow-sm hover:shadow-md motion-safe:transition-[box-shadow,border-color] sm:flex-row sm:items-center sm:p-6"
              >
                <span
                  className={`grid size-12 shrink-0 place-items-center rounded-xl max-sm:hidden ${
                    posting.shown === "LIVE" ? "bg-night text-signal" : "bg-muted text-ink-muted"
                  }`}
                >
                  <Icon name="briefcase" className="size-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink block text-lg font-semibold break-words group-hover:underline group-hover:underline-offset-4">
                    {posting.offer.title}
                  </span>
                  <span className="text-ink-muted mt-1 block">
                    {[
                      posting.offer.city,
                      posting.shown === "LIVE" && posting.expiresAt
                        ? tp("liveUntil", { date: format.dateTime(posting.expiresAt, "short") })
                        : null,
                      tp("views", { count: posting.viewCount }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <PostingStatusBadge status={posting.shown} />
                  <Icon
                    name="chevron"
                    className="text-ink-subtle size-5 -rotate-90 max-sm:hidden"
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-muted mt-8 flex max-w-3xl items-start gap-2 text-sm">
        <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
        {t("privacy")}
      </p>
    </div>
  );
}
