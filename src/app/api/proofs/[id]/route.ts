import { getCurrentUser } from "@/lib/auth/session";
import { safeFileName } from "@/lib/career/documents";
import { getProofDocument } from "@/lib/career/repository";

/**
 * Téléchargement d'une pièce justificative. Seul son propriétaire y a accès :
 * pour tout autre utilisateur, la réponse est un 404 (on ne révèle pas
 * l'existence du fichier). Jamais mis en cache.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const document = await getProofDocument(user.id, id);
  if (!document) return new Response(null, { status: 404 });

  const fileName = safeFileName(document.fileName, document.mimeType);
  return new Response(new Uint8Array(document.bytes), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Length": String(document.bytes.length),
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
