import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { DeleteButton } from "@/components/delete-button";
import { PageTitle } from "@/components/empty-state";
import { Link } from "@/i18n/navigation";
import { isAiConfigured } from "@/lib/ai/server";
import { requireUser } from "@/lib/auth/session";
import { isBillingAvailable } from "@/lib/billing/config";
import { getEntitlements } from "@/lib/billing/server";
import { remainingMessages } from "@/lib/coach/quota";
import { countRecentUserMessages, listConversations } from "@/lib/coach/repository";
import { COACH_MODES } from "@/lib/coach/shared";
import { removeConversation, startConversation } from "./actions";
import { AiNotice } from "./ai-notice";
import { CoachUpsell } from "./upsell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("coach");
  return { title: t("title") };
}

export default async function CoachPage() {
  const user = await requireUser();
  const [t, format, conversations, sent, entitlements] = await Promise.all([
    getTranslations("coach"),
    getFormatter(),
    listConversations(user.id),
    countRecentUserMessages(user.id),
    getEntitlements(user.id),
  ]);
  const configured = isAiConfigured();
  const limit = entitlements.limits.coachMessagesPerDay;
  const remaining = remainingMessages(sent, limit);

  return (
    <div className="max-w-4xl">
      <PageTitle title={t("title")} intro={t("intro")} />
      <AiNotice />
      {!configured ? (
        <p className="border-warning-line bg-warning-soft text-warning-ink mb-6 rounded-lg border px-4 py-3 text-sm">
          {t("notConfigured")}
        </p>
      ) : null}

      <section aria-labelledby="coach-start" className="mb-10">
        <h2 id="coach-start" className="text-lg font-semibold">
          {t("start.title")}
        </h2>
        <p className="text-ink-muted mt-1 text-sm">{t("start.intro")}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {COACH_MODES.map((mode) => (
            <li key={mode}>
              <form
                action={startConversation.bind(null, mode)}
                className="border-line bg-surface flex h-full flex-col rounded-xl border p-4"
              >
                <h3 className="font-medium">{t(`modes.${mode}.title`)}</h3>
                <p className="text-ink-muted mt-1 flex-1 text-sm">
                  {t(`modes.${mode}.description`)}
                </p>
                <button
                  type="submit"
                  disabled={!configured || remaining === 0}
                  aria-label={t("start.buttonFor", { mode: t(`modes.${mode}.title`) })}
                  className="bg-primary text-on-primary hover:bg-primary-hover mt-4 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {t("start.button")}
                </button>
              </form>
            </li>
          ))}
        </ul>
        {limit !== null && remaining === 0 ? (
          <div className="mt-4">
            <CoachUpsell limit={limit} billing={isBillingAvailable()} />
          </div>
        ) : (
          <p className="text-ink-subtle mt-3 text-sm">
            {remaining === null ? t("quotaUnlimited") : t("quota", { remaining })}
          </p>
        )}
      </section>

      <section aria-labelledby="coach-history">
        <h2 id="coach-history" className="text-lg font-semibold">
          {t("history.title")}
        </h2>
        {conversations.length === 0 ? (
          <p className="border-line-strong bg-surface text-ink-subtle mt-3 rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            {t("history.empty")}
          </p>
        ) : (
          <ul className="divide-line border-line bg-surface mt-3 divide-y rounded-xl border">
            {conversations.map((conversation) => (
              <li
                key={conversation.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    href={`/app/coach/${conversation.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {t(`modes.${conversation.mode}.title`)}
                  </Link>
                  <p className="text-ink-subtle text-sm">
                    {t("history.updated", {
                      date: format.dateTime(conversation.updatedAt, "short"),
                    })}
                    {" · "}
                    {t("history.messages", { count: conversation.messageCount })}
                    {conversation.pendingSuggestions > 0 ? (
                      <>
                        {" · "}
                        <span className="text-brand-ink">
                          {t("history.pending", { count: conversation.pendingSuggestions })}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/app/coach/${conversation.id}`}
                    className="border-line-strong hover:bg-muted rounded-lg border px-2.5 py-1 text-sm font-medium"
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
        )}
      </section>
    </div>
  );
}
