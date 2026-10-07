import { getCurrentUser } from "@/lib/auth/session";
import { threadCv } from "@/lib/employer/inbox";
import { getMembership } from "@/lib/employer/repository";

/**
 * CV révélé dans un fil de la messagerie de l'espace entreprise. Réservé aux
 * membres de l'organisation destinataire : non connecté, non-membre, fil
 * d'une autre organisation, levée révoquée ou expirée : 404 sans distinguer.
 */

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const notFound = () => new Response(null, { status: 404, headers: HEADERS });
  const user = await getCurrentUser();
  if (!user) return notFound();
  const membership = await getMembership(user.id);
  if (!membership) return notFound();
  const { id } = await params;
  const file = await threadCv(membership.organization.id, id);
  if (!file) return notFound();
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      ...HEADERS,
      "Content-Type": file.type,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `attachment; filename="${file.name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
