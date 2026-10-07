import { getCurrentUser } from "@/lib/auth/session";
import { exportUserData } from "@/lib/career/repository";
import { logger } from "@/lib/logger";

/** Export RGPD : toutes les données de l'utilisateur connecté, en JSON. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const data = await exportUserData(user.id);
  logger.info("account.exported", { userId: user.id });
  const date = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="coach-career-ia-export-${date}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
