import { getCurrentUser } from "@/lib/auth/session";
import { getConversation } from "@/lib/coach/repository";

/**
 * Conversation du coach (messages et suggestions). Seul son propriétaire y a
 * accès : pour tout autre utilisateur, 404 (on ne révèle pas son existence).
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const conversation = await getConversation(user.id, id);
  if (!conversation) return Response.json({ error: "notFound" }, { status: 404 });
  return Response.json(conversation, { headers: { "Cache-Control": "private, no-store" } });
}
