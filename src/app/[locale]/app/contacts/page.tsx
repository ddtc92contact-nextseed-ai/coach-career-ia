import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { EmptyState, PageTitle } from "@/components/empty-state";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { getQuota, listContacts } from "@/lib/contact/repository";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contacts");
  return { title: t("title") };
}

/** Boîte de réception : prises de contact (historique complet) et réponses des entreprises. */
export default async function ContactsPage() {
  const user = await requireUser();
  const [t, th, format, contacts, quota] = await Promise.all([
    getTranslations("contacts"),
    getTranslations("handover"),
    getFormatter(),
    listContacts(user.id),
    getQuota(user.id),
  ]);

  return (
    <div className="max-w-3xl">
      <PageTitle title={t("title")} intro={t("intro")} />
      <p className="text-ink-muted mb-6 text-sm">
        {t("quota", { remaining: quota.remaining, limit: quota.limit })}
      </p>
      {contacts.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          text={t("emptyText")}
          action={
            <Link
              href="/app/opportunites"
              className="bg-primary text-on-primary hover:bg-primary-hover inline-block rounded-lg px-4 py-2.5 text-sm font-medium"
            >
              {t("emptyAction")}
            </Link>
          }
        />
      ) : (
        <ul className="divide-line border-line bg-surface divide-y rounded-2xl border">
          {contacts.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/contacts/${c.id}`}
                className="hover:bg-subtle flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words">{c.offer.title}</p>
                  <p className="text-ink-muted text-sm">
                    {[
                      c.offer.companyName ?? t("companyUnknown"),
                      t(`channel.${c.channel}`),
                      c.sentAt
                        ? t(c.channel === "APPLY_URL" ? "submittedOn" : "sentOn", {
                            date: format.dateTime(c.sentAt, "short"),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge tone={c.status === "SENT" ? "proven" : "neutral"}>
                    {t(`status.${c.status}`)}
                  </Badge>
                  {c.revealed ? <Badge tone="proven">{th("status.revealed")}</Badge> : null}
                  {c.replies > 0 ? (
                    <Badge tone={c.unread > 0 ? "warning" : "neutral"}>
                      {c.unread > 0
                        ? t("unread", { count: c.unread })
                        : t("replies", { count: c.replies })}
                    </Badge>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
