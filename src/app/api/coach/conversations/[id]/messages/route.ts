import { z } from "zod";
import { getAiClient, isAiConfigured } from "@/lib/ai/server";
import { getCurrentUser } from "@/lib/auth/session";
import { coachMessagesPerDay, remainingMessages } from "@/lib/coach/quota";
import {
  addMessage,
  countRecentUserMessages,
  findConversation,
  loadHistory,
} from "@/lib/coach/repository";
import { COACH_LIMITS, type CoachErrorCode } from "@/lib/coach/shared";
import { streamCoachTurn } from "@/lib/coach/turn";
import { getUserLocale } from "@/lib/i18n/user-locale";

/**
 * Envoie un message au coach et diffuse sa réponse (NDJSON : un évènement
 * `CoachStreamEvent` par ligne). `{ retry: true }` relance le dernier message
 * resté sans réponse (après une panne), sans le décompter du quota.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const body = z.union([
  z.object({
    content: z.string().trim().min(1).max(COACH_LIMITS.messageMaxChars),
    retry: z.literal(false).optional(),
  }),
  z.object({ retry: z.literal(true) }),
]);

const STATUS: Partial<Record<CoachErrorCode, number>> = {
  unauthorized: 401,
  notFound: 404,
  invalid: 400,
  quotaExceeded: 429,
  aiNotConfigured: 503,
};

function fail(code: CoachErrorCode, extra: Record<string, unknown> = {}) {
  return Response.json(
    { error: code, ...extra },
    { status: STATUS[code] ?? 500, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("unauthorized");
  const { id } = await params;
  const conversation = await findConversation(user.id, id);
  if (!conversation) return fail("notFound");

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid");
  if (!isAiConfigured()) return fail("aiNotConfigured");

  const limit = coachMessagesPerDay();
  const sent = await countRecentUserMessages(user.id);
  let userMessage: { id: string; createdAt: Date };
  let remaining: number;
  if (parsed.data.retry) {
    // Nouvel essai : seulement si le dernier message est du candidat, sans réponse.
    const [last] = await loadHistory(user.id, id, 1).then((rows) => rows.slice(-1));
    if (!last || last.role !== "USER") return fail("invalid");
    userMessage = last;
    remaining = remainingMessages(sent, limit);
  } else {
    if (sent >= limit) return fail("quotaExceeded", { limit });
    userMessage = await addMessage(user.id, id, "USER", parsed.data.content);
    remaining = remainingMessages(sent + 1, limit);
  }

  const stream = streamCoachTurn({
    ai: getAiClient(),
    userId: user.id,
    conversationId: id,
    mode: conversation.mode,
    locale: await getUserLocale(user.id),
    signal: request.signal,
    userMessage,
    remaining,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
