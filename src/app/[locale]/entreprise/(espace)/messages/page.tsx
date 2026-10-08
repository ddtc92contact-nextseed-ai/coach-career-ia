import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Link } from "@/i18n/navigation";
import { listThreads } from "@/lib/employer/inbox";
import { requireEmployer } from "@/lib/employer/session";
import { ThreadStatusBadge } from "./status-badge";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.inbox");
  return { title: t("title") };
}

/**
 * Messagerie : un fil par prise de contact anonyme reçue sur une offre de
 * l'organisation. Seuls l'intitulé de l'offre, la date et le statut sont
 * listés : aucun profil, aucune recherche ni aucun classement de candidats.
 */
export default async function EmployerInboxPage() {
  const { org } = await requireEmployer();
  const [t, format, threads] = await Promise.all([
    getTranslations("employer.inbox"),
    getFormatter(),
    listThreads(org.id),
  ]);

  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} lead={t("intro")} />
      {threads.length === 0 ? (
        <EmptyState title={t("emptyTitle")} text={t("emptyText")} />
      ) : (
        <ul aria-label={t("title")} className="space-y-3">
          {threads.map((thread) => {
            const unread = thread.status === "NEW";
            return (
              <li key={thread.id}>
                <Link
                  href={`/entreprise/messages/${thread.id}`}
                  className={`group bg-surface hover:border-line-strong flex flex-col gap-3 rounded-2xl border p-4 shadow-sm hover:shadow-md motion-safe:transition-[box-shadow,border-color] sm:flex-row sm:items-center sm:gap-4 sm:p-5 ${
                    unread ? "border-brand-line ring-brand-line ring-1" : "border-line"
                  }`}
                >
                  <span
                    className={`relative grid size-12 shrink-0 place-items-center rounded-xl max-sm:hidden ${
                      unread ? "bg-night text-signal" : "bg-muted text-ink-muted"
                    }`}
                  >
                    <Icon name="chat" className="size-6" />
                    {unread ? (
                      <span
                        aria-hidden="true"
                        className="bg-signal ring-surface absolute -top-1 -right-1 size-3 rounded-full ring-2"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`text-ink block text-lg break-words group-hover:underline group-hover:underline-offset-4 ${
                        unread ? "font-bold" : "font-semibold"
                      }`}
                    >
                      {t("threadTitle", { title: thread.offerTitle })}
                    </span>
                    {thread.lastActivityAt ? (
                      <span className="text-ink-muted mt-0.5 block">
                        {t("lastActivity", {
                          date: format.dateTime(thread.lastActivityAt, "short"),
                        })}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 max-sm:order-first">
                    <ThreadStatusBadge status={thread.status} />
                    <Icon
                      name="chevron"
                      className="text-ink-subtle size-5 -rotate-90 max-sm:hidden"
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-ink-muted mt-8 flex items-start gap-2 text-sm">
        <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
        {t("privacy")}
      </p>
    </div>
  );
}
