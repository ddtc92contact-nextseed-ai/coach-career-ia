import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState, PageTitle } from "@/components/empty-state";
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
    <div>
      <PageTitle title={t("title")} intro={t("intro")} />
      {threads.length === 0 ? (
        <EmptyState title={t("emptyTitle")} text={t("emptyText")} />
      ) : (
        <ul className="divide-line border-line bg-surface divide-y overflow-hidden rounded-2xl border">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/entreprise/messages/${thread.id}`}
                className="hover:bg-subtle flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <span className="min-w-0">
                  <span
                    className={`text-ink block break-words ${
                      thread.status === "NEW" ? "font-semibold" : "font-medium"
                    }`}
                  >
                    {t("threadTitle", { title: thread.offerTitle })}
                  </span>
                  {thread.lastActivityAt ? (
                    <span className="text-ink-subtle block text-xs">
                      {t("lastActivity", {
                        date: format.dateTime(thread.lastActivityAt, "short"),
                      })}
                    </span>
                  ) : null}
                </span>
                <ThreadStatusBadge status={thread.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-subtle mt-6 text-xs">{t("privacy")}</p>
    </div>
  );
}
