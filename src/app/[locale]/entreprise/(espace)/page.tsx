import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState, PageTitle } from "@/components/empty-state";
import { Link } from "@/i18n/navigation";
import { postingDurationDays } from "@/lib/employer/config";
import { listPostings } from "@/lib/employer/repository";
import { requireEmployer } from "@/lib/employer/session";
import { OrganizationNotice, PostingStatusBadge } from "./parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.dashboard");
  return { title: t("title") };
}

const primaryButton =
  "inline-block rounded-lg bg-stone-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-stone-700";

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
  const newLink = (
    <Link href="/entreprise/offres/nouvelle" className={primaryButton}>
      {t("newPosting")}
    </Link>
  );

  return (
    <div>
      <OrganizationNotice org={org} />
      <PageTitle
        title={t("title")}
        intro={t("intro", { days: postingDurationDays() })}
        action={postings.length > 0 ? newLink : undefined}
      />
      {postings.length === 0 ? (
        <EmptyState title={t("emptyTitle")} text={t("emptyText")} action={newLink} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500 max-sm:sr-only">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("columns.title")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("columns.status")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("columns.expires")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t("columns.views")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {postings.map((posting) => (
                <tr
                  key={posting.id}
                  className="max-sm:flex max-sm:flex-wrap max-sm:gap-x-3 max-sm:py-3"
                >
                  <td className="px-4 py-3 max-sm:w-full max-sm:py-0">
                    <Link
                      href={`/entreprise/offres/${posting.id}`}
                      className="font-medium break-words text-stone-900 hover:underline"
                    >
                      {posting.offer.title}
                    </Link>
                    {posting.offer.city ? (
                      <span className="block text-xs text-stone-500">{posting.offer.city}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 max-sm:py-1">
                    <PostingStatusBadge status={posting.status} />
                  </td>
                  <td className="px-4 py-3 text-stone-600 tabular-nums max-sm:py-1">
                    {posting.status === "LIVE" && posting.expiresAt ? (
                      <>
                        <span className="max-sm:hidden">
                          {format.dateTime(posting.expiresAt, "short")}
                        </span>
                        <span className="sm:hidden">
                          {tp("liveUntil", { date: format.dateTime(posting.expiresAt, "short") })}
                        </span>
                      </>
                    ) : (
                      <span className="max-sm:hidden">{t("noDate")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-600 tabular-nums max-sm:w-full max-sm:py-0 max-sm:text-left max-sm:text-xs">
                    <span className="max-sm:hidden">{posting.viewCount}</span>
                    <span className="sm:hidden">{tp("views", { count: posting.viewCount })}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-6 text-xs text-stone-500">{t("privacy")}</p>
    </div>
  );
}
