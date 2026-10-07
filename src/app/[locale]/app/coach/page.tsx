import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { DeleteButton } from "@/components/delete-button";
import { PageTitle } from "@/components/empty-state";
import { Link } from "@/i18n/navigation";
import { isAiConfigured } from "@/lib/ai/server";
import { requireUser } from "@/lib/auth/session";
import { coachMessagesPerDay, remainingMessages } from "@/lib/coach/quota";
import { countRecentUserMessages, listConversations } from "@/lib/coach/repository";
import { COACH_MODES } from "@/lib/coach/shared";
import { removeConversation, startConversation } from "./actions";
import { AiNotice } from "./ai-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("coach");
  return { title: t("title") };
}

export default async function CoachPage() {
  const user = await requireUser();
  const [t, format, conversations, sent] = await Promise.all([
    getTranslations("coach"),
    getFormatter(),
    listConversations(user.id),
    countRecentUserMessages(user.id),
  ]);
  const configured = isAiConfigured();
  const remaining = remainingMessages(sent, coachMessagesPerDay());

  return (
    <div className="max-w-4xl">
      <PageTitle title={t("title")} intro={t("intro")} />
      <AiNotice />
      {!configured ? (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t("notConfigured")}
        </p>
      ) : null}

      <section aria-labelledby="coach-start" className="mb-10">
        <h2 id="coach-start" className="text-lg font-semibold">
          {t("start.title")}
        </h2>
        <p className="mt-1 text-sm text-stone-600">{t("start.intro")}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {COACH_MODES.map((mode) => (
            <li key={mode}>
              <form
                action={startConversation.bind(null, mode)}
                className="flex h-full flex-col rounded-xl border border-stone-200 bg-white p-4"
              >
                <h3 className="font-medium">{t(`modes.${mode}.title`)}</h3>
                <p className="mt-1 flex-1 text-sm text-stone-600">
                  {t(`modes.${mode}.description`)}
                </p>
                <button
                  type="submit"
                  disabled={!configured || remaining === 0}
                  className="mt-4 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
                >
                  {t("start.button")}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-stone-500">{t("quota", { remaining })}</p>
      </section>

      <section aria-labelledby="coach-history">
        <h2 id="coach-history" className="text-lg font-semibold">
          {t("history.title")}
        </h2>
        {conversations.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-stone-300 bg-white px-4 py-6 text-center text-sm text-stone-500">
            {t("history.empty")}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
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
                  <p className="text-sm text-stone-500">
                    {t("history.updated", {
                      date: format.dateTime(conversation.updatedAt, "short"),
                    })}
                    {" · "}
                    {t("history.messages", { count: conversation.messageCount })}
                    {conversation.pendingSuggestions > 0 ? (
                      <>
                        {" · "}
                        <span className="text-brand-800">
                          {t("history.pending", { count: conversation.pendingSuggestions })}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/app/coach/${conversation.id}`}
                    className="rounded-lg border border-stone-300 px-2.5 py-1 text-sm font-medium hover:bg-stone-100"
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
