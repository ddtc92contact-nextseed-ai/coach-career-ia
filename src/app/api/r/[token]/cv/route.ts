import { handoverCv } from "@/lib/handover/repository";

/**
 * CV révélé par une levée d'anonymat (lien à jeton, sans connexion).
 * Jeton inconnu : 404 ; levée révoquée ou expirée : 410 (données effacées).
 */

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await handoverCv(token);
  if (result.status !== "active") {
    return new Response(null, { status: result.status === "gone" ? 410 : 404, headers: HEADERS });
  }
  if (!result.file) return new Response(null, { status: 404, headers: HEADERS });
  const { file } = result;
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
