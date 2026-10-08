import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { getQuota, listContacts } from "@/lib/contact/repository";
import { ContactStatusBadge, needsAction } from "./contact-status";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contacts");
  return { title: t("title") };
}

/** Boîte de réception : prises de contact (historique complet) et réponses des entreprises. */
export default async function ContactsPage() {
  const user = await requireUser();
  const [t, tn, th, format, contacts, quota] = await Promise.all([
    getTranslations("contacts"),
    getTranslations("app.nav.groups"),
    getTranslations("handover"),
    getFormatter(),
    listContacts(user.id),
    getQuota(user.id),
  ]);
  const toApprove = contacts.filter((c) => c.status === "DRAFT" || c.status === "APPROVED").length;
  const unread = contacts.reduce((sum, c) => sum + c.unread, 0);

  return (
    <>
      <PageHeader title={t("title")} lead={t("intro")} eyebrow={tn("agent")} band="brand">
        <ul className="text-ink-muted mt-5 flex flex-wrap gap-2 text-sm">
          <li className="bg-surface/80 ring-brand-line inline-flex items-center gap-2 rounded-full px-3 py-1.5 ring-1">
            <Icon name="send" className="text-brand-ink size-4" />
            {t("quota", { remaining: quota.remaining, limit: quota.limit })}
          </li>
          {toApprove > 0 ? (
            <li className="bg-warning-soft text-warning-ink ring-warning-line inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium ring-1">
              <Icon name="clock" className="size-4" />
              {t("inbox.toApprove", { count: toApprove })}
            </li>
          ) : null}
          {unread > 0 ? (
            <li className="bg-brand text-on-brand ring-brand inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium ring-1">
              <Icon name="reply" className="size-4" />
              {t("unread", { count: unread })}
            </li>
          ) : null}
        </ul>
      </PageHeader>

      {contacts.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={t("emptyTitle")}
          text={t("emptyText")}
          action={
            <Link href="/app/opportunites" className={buttonClass("primary")}>
              {t("emptyAction")}
            </Link>
          }
        />
      ) : (
        <section
          aria-labelledby="boite"
          className="border-line bg-surface overflow-hidden rounded-2xl border shadow-sm"
        >
          <h2
            id="boite"
            className="border-line bg-subtle text-ink-muted flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold sm:px-6"
          >
            <Icon name="inbox" className="size-4" />
            {t("inbox.title", { count: contacts.length })}
          </h2>
          <ul className="divide-line divide-y">
            {contacts.map((c) => {
              const action = needsAction(c);
              return (
                <li key={c.id}>
                  <Link
                    href={`/app/contacts/${c.id}`}
                    className={`group hover:bg-subtle flex items-start gap-3 border-l-4 px-4 py-4 motion-safe:transition-colors sm:items-center sm:gap-4 sm:px-6 ${
                      action ? "border-brand" : "border-transparent"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`relative mt-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-xl sm:mt-0 ${
                        c.unread > 0 ? "bg-brand-soft text-brand-ink" : "bg-muted text-ink-muted"
                      }`}
                    >
                      <Icon
                        name={c.channel === "PORTAL" ? "building" : "mail"}
                        className="size-5"
                      />
                      {c.unread > 0 ? (
                        <span className="bg-brand ring-surface absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2" />
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`break-words ${c.unread > 0 || action ? "font-semibold" : "font-medium"}`}
                      >
                        {c.offer.title}
                      </p>
                      <p className="text-ink-muted mt-0.5 text-sm break-words">
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
                      <div className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
                        <ContactStatusBadge contact={c} />
                        {c.revealed ? (
                          <Badge tone="night" icon="unlock">
                            {th("status.revealed")}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="hidden shrink-0 flex-wrap items-center justify-end gap-2 sm:flex">
                      <ContactStatusBadge contact={c} />
                      {c.revealed ? (
                        <Badge tone="night" icon="unlock">
                          {th("status.revealed")}
                        </Badge>
                      ) : null}
                    </div>
                    <Icon
                      name="chevron"
                      className="text-ink-subtle mt-3 size-5 shrink-0 -rotate-90 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5 sm:mt-0"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
