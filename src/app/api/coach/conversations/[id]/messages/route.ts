import { z } from "zod";
import { getAiClient, isAiConfigured } from "@/lib/ai/server";
import { getCurrentUser } from "@/lib/auth/session";
import { coachMessagesPerDay, remainingMessages } from "@/lib/coach/quota";
import {
  acquireTurn,
  addUserMessageWithinQuota,
  claimRetry,
  countRecentUserMessages,
  findConversation,
  loadHistory,
  releaseTurn,
} from "@/lib/coach/repository";
import { COACH_LIMITS, type CoachErrorCode } from "@/lib/coach/shared";
import { streamCoachTurn } from "@/lib/coach/turn";
import { getUserLocale } from "@/lib/i18n/user-locale";

/**
 * Envoie un message au coach et diffuse sa réponse (NDJSON : un évènement
 * `CoachStreamEvent` par ligne). `{ retry: true }` relance le dernier message
 * resté sans réponse (après une panne), sans le décompter du quota, au plus
 * `COACH_LIMITS.maxRetries` fois. Un seul tour à la fois par conversation
 * (verrou `turnStartedAt`) ; quota vérifié et message inséré atomiquement.
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
  tooManyRetries: 429,
  busy: 409,
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
  // Limite à 0 : coach coupé, relances comprises.
  if (limit === 0) return fail("quotaExceeded", { limit });
  // Un seul tour à la fois par conversation : envois ou relances simultanés → 409.
  if (!(await acquireTurn(user.id, id))) return fail("busy");

  let userMessage: { id: string; createdAt: Date };
  let remaining: number;
  try {
    if (parsed.data.retry) {
      // Nouvel essai : seulement si le dernier message est du candidat, sans réponse.
      const [last] = await loadHistory(user.id, id, 1);
      if (!last || last.role !== "USER") {
        await releaseTurn(user.id, id);
        return fail("invalid");
      }
      if (!(await claimRetry(user.id, last.id))) {
        await releaseTurn(user.id, id);
        return fail("tooManyRetries");
      }
      userMessage = last;
      remaining = remainingMessages(await countRecentUserMessages(user.id), limit);
    } else {
      const added = await addUserMessageWithinQuota(user.id, id, parsed.data.content, limit);
      if (!added) {
        await releaseTurn(user.id, id);
        return fail("quotaExceeded", { limit });
      }
      userMessage = added.message;
      remaining = remainingMessages(added.sent, limit);
    }
  } catch (error) {
    await releaseTurn(user.id, id);
    throw error;
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
    onFinish: () => releaseTurn(user.id, id),
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
