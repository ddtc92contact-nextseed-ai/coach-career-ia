import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
      <Link href="/app/coach" className="text-sm text-stone-600 underline-offset-2 hover:underline">
        ← {t("chat.back")}
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-semibold tracking-tight">
        {t(`modes.${conversation.mode}.title`)}
      </h1>
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
