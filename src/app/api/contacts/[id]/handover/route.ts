import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/career/repository";
import { contactDeps } from "@/lib/contact/server";
import { revealIdentity, type RevealFile } from "@/lib/handover/repository";
import { MAX_CV_BYTES } from "@/lib/vault/identity";

/**
 * Levée d'anonymat, à la confirmation du candidat (formulaire multipart) :
 * - `payload` : JSON des seuls champs choisis, déchiffrés dans le navigateur ;
 * - `cv` : CV d'origine déchiffré dans le navigateur, seulement s'il est coché.
 * Contact d'un autre candidat : 404. Rien n'est journalisé du contenu.
 */

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
/** Champs JSON (≤ 64 Ko) + CV (5 Mo) + enveloppe multipart. */
const MAX_BODY_BYTES = MAX_CV_BYTES + 128 * 1024;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return json({ error: "cvInvalid" }, 413);
  }
  const { id } = await params;

  let payload: unknown;
  let cv: RevealFile | null = null;
  try {
    const form = await request.formData();
    const raw = form.get("payload");
    if (typeof raw !== "string" || raw.length > 64 * 1024) return json({ error: "invalid" }, 400);
    payload = JSON.parse(raw);
    const file = form.get("cv");
    if (file instanceof File) {
      if (file.size > MAX_CV_BYTES) return json({ error: "cvInvalid" }, 413);
      cv = { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
    } else if (file !== null) {
      return json({ error: "invalid" }, 400);
    }
  } catch {
    return json({ error: "invalid" }, 400);
  }

  const deps = contactDeps();
  try {
    const result = await revealIdentity(
      user.id,
      id,
      { payload, cv },
      {
        send: deps.send,
        appUrl: deps.appUrl,
      },
    );
    if (!result.ok) {
      const status = result.error === "invalid" || result.error === "cvInvalid" ? 400 : 409;
      return json({ error: result.error }, status);
    }
    revalidatePath("/[locale]/app", "layout");
    return json({ ok: true, url: result.url, expiresAt: result.expiresAt.toISOString() });
  } catch (error) {
    if (error instanceof NotFoundError) return json({ error: "notFound" }, 404);
    throw error;
  }
}
