import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Link } from "@/i18n/navigation";
import { isAiConfigured } from "@/lib/ai/server";
import { requireUser } from "@/lib/auth/session";
import { isBillingAvailable } from "@/lib/billing/config";
import { getEntitlements } from "@/lib/billing/server";
import { remainingMessages } from "@/lib/coach/quota";
import { countRecentUserMessages, getConversation } from "@/lib/coach/repository";
import { AiNotice } from "../ai-notice";
import { CoachChat } from "./chat";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("coach");
  return { title: t("title") };
}

export default async function CoachConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  // Conversation d'un autre utilisateur : 404, comme une conversation inexistante.
  const [t, conversation, sent, entitlements] = await Promise.all([
    getTranslations("coach"),
    getConversation(user.id, id),
    countRecentUserMessages(user.id),
    getEntitlements(user.id),
  ]);
  if (!conversation) notFound();
  const limit = entitlements.limits.coachMessagesPerDay;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/app/coach"
        className="text-ink-muted hover:text-ink mb-4 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
      >
        <Icon name="arrow" className="size-4 rotate-180" />
        {t("chat.back")}
      </Link>
      <PageHeader title={t(`modes.${conversation.mode}.title`)} eyebrow={t("title")} />
      <AiNotice />
      <CoachChat
        conversationId={conversation.id}
        mode={conversation.mode}
        initialMessages={conversation.messages}
        initialRemaining={remainingMessages(sent, limit)}
        limit={limit}
        configured={isAiConfigured()}
        billing={isBillingAvailable()}
      />
    </div>
  );
}
