import { getCurrentUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { getCv, setCv } from "@/lib/vault/repository";
import { isCvEnvelope, MAX_CV_CIPHERTEXT_BYTES } from "@/lib/vault/schemas";

/**
 * CV d'origine, chiffré dans le navigateur (nom et type de fichier compris) :
 * le serveur reçoit et renvoie un flux d'octets opaque. 404 si l'utilisateur
 * courant n'a pas de coffre ou pas de CV.
 */

const NO_STORE = { "Cache-Control": "private, no-store" };
const empty = (status: number) => new Response(null, { status, headers: NO_STORE });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return empty(401);
  const cv = await getCv(user.id);
  if (!cv) return empty(404);
  return new Response(new Uint8Array(cv), {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(cv.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return empty(401);
  if (request.headers.get("content-type") !== "application/octet-stream") return empty(415);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_CV_CIPHERTEXT_BYTES) return empty(413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!isCvEnvelope(bytes)) return empty(bytes.length > MAX_CV_CIPHERTEXT_BYTES ? 413 : 400);
  if (!(await setCv(user.id, bytes))) return empty(404);
  logger.info("vault.cv_saved", { userId: user.id, sizeBytes: bytes.length });
  return empty(204);
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return empty(401);
  const cv = await getCv(user.id);
  if (!cv) return empty(404);
  await setCv(user.id, null);
  logger.info("vault.cv_deleted", { userId: user.id });
  return empty(204);
}
