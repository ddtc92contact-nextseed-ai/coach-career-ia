import { db } from "@/lib/db";
import { unsubscribeAlerts } from "@/lib/matching/alerts";

/**
 * Désabonnement en un clic (RFC 8058) : le client de messagerie envoie
 * `POST <List-Unsubscribe>` avec `List-Unsubscribe=One-Click`. Le jeton
 * aléatoire de l'URL fait foi ; aucune session n'est requise.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const ok = await unsubscribeAlerts(db, token);
  return new Response(null, { status: ok ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
