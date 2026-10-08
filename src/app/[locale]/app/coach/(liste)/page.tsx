import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { Card, CardHeader } from "@/components/card";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Link } from "@/i18n/navigation";
import { isAiConfigured } from "@/lib/ai/server";
import { requireUser } from "@/lib/auth/session";
import { isBillingAvailable } from "@/lib/billing/config";
import { getEntitlements } from "@/lib/billing/server";
import { remainingMessages } from "@/lib/coach/quota";
import { countRecentUserMessages, listConversations } from "@/lib/coach/repository";
import { COACH_MODES } from "@/lib/coach/shared";
import { removeConversation, startConversation } from "../actions";
import { AiNotice } from "../ai-notice";
import { MODE_ICONS } from "../mode-icons";
import { CoachUpsell } from "../upsell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("coach");
  return { title: t("title") };
}

export default async function CoachPage() {
  const user = await requireUser();
  const [t, tn, format, conversations, sent, entitlements] = await Promise.all([
    getTranslations("coach"),
    getTranslations("app.nav.groups"),
    getFormatter(),
    listConversations(user.id),
    countRecentUserMessages(user.id),
    getEntitlements(user.id),
  ]);
  const configured = isAiConfigured();
  const limit = entitlements.limits.coachMessagesPerDay;
  const remaining = remainingMessages(sent, limit);
  const canStart = configured && remaining !== 0;

  return (
    <>
      <PageHeader title={t("title")} lead={t("intro")} eyebrow={tn("agent")} band="brand">
        {configured && !(limit !== null && remaining === 0) ? (
          <p className="bg-surface/80 text-ink-muted ring-brand-line mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1">
            <Icon name="chat" className="text-brand-ink size-4" />
            {remaining === null ? t("quotaUnlimited") : t("quota", { remaining })}
          </p>
        ) : null}
      </PageHeader>

      <AiNotice />
      {!configured ? (
        <p
          role="status"
          className="border-warning-line bg-warning-soft text-warning-ink mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3"
        >
          <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
          {t("notConfigured")}
        </p>
      ) : null}

      <section aria-labelledby="coach-start" className="mb-8">
        <h2
          id="coach-start"
          className="font-display text-xl font-bold tracking-tight text-balance sm:text-2xl"
        >
          {t("start.title")}
        </h2>
        <p className="text-ink-muted mt-1.5">{t("start.intro")}</p>
        <ul className="mt-5 grid gap-4 md:grid-cols-3">
          {COACH_MODES.map((mode) => (
            <li key={mode}>
              <form action={startConversation.bind(null, mode)} className="h-full">
                <button
                  type="submit"
                  disabled={!canStart}
                  aria-label={t("start.buttonFor", { mode: t(`modes.${mode}.title`) })}
                  className="group border-line bg-surface hover:border-brand-line flex h-full w-full flex-col rounded-2xl border p-5 text-left shadow-sm enabled:hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-[border-color,box-shadow] sm:p-6"
                >
                  <span className="bg-brand-soft text-brand-ink inline-flex size-11 items-center justify-center rounded-xl">
                    <Icon name={MODE_ICONS[mode]} className="size-6" />
                  </span>
                  <span className="mt-4 block text-lg font-semibold text-balance">
                    {t(`modes.${mode}.title`)}
                  </span>
                  <span className="text-ink-muted mt-1.5 block flex-1 text-pretty">
                    {t(`modes.${mode}.description`)}
                  </span>
                  <span className="text-brand-ink mt-4 inline-flex items-center gap-1.5 font-semibold">
                    {t("start.button")}
                    <Icon
                      name="arrow"
                      className="size-4 motion-safe:transition-transform motion-safe:group-enabled:group-hover:translate-x-0.5"
                    />
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        {limit !== null && remaining === 0 ? (
          <div className="mt-5">
            <CoachUpsell limit={limit} billing={isBillingAvailable()} />
          </div>
        ) : null}
      </section>

      {conversations.length === 0 ? (
        <section aria-labelledby="coach-history">
          <h2
            id="coach-history"
            className="font-display mb-4 text-xl font-bold tracking-tight sm:text-2xl"
          >
            {t("history.title")}
          </h2>
          <EmptyState icon="chat" title={t("history.empty")} text={t("history.emptyText")} />
        </section>
      ) : (
        <Card aria-labelledby="coach-history">
          <CardHeader id="coach-history" title={t("history.title")} />
          <ul className="divide-line mt-4 -mb-2 divide-y">
            {conversations.map((conversation) => (
              <li
                key={conversation.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="bg-muted text-ink-muted inline-flex size-10 shrink-0 items-center justify-center rounded-xl">
                    <Icon name={MODE_ICONS[conversation.mode]} className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={`/app/coach/${conversation.id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {t(`modes.${conversation.mode}.title`)}
                    </Link>
                    <p className="text-ink-subtle mt-0.5 text-sm">
                      {t("history.updated", {
                        date: format.dateTime(conversation.updatedAt, "short"),
                      })}
                      {" · "}
                      {t("history.messages", { count: conversation.messageCount })}
                    </p>
                    {conversation.pendingSuggestions > 0 ? (
                      <p className="mt-2">
                        <Badge tone="warning" icon="clock">
                          {t("history.pending", { count: conversation.pendingSuggestions })}
                        </Badge>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 pl-13 sm:pl-0">
                  <Link
                    href={`/app/coach/${conversation.id}`}
                    className={buttonClass("secondary", "sm")}
                  >
                    {t("history.open")}
                  </Link>
                  <DeleteButton
                    small
                    action={removeConversation.bind(null, conversation.id, false)}
                    confirmMessage={t("history.confirmDelete")}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
