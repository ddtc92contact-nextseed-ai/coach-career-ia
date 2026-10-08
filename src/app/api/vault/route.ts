import { accountKdf } from "@/lib/auth/accounts";
import { getCurrentUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { createVault, deleteVault, getVault, updateVault } from "@/lib/vault/repository";
import { ACCOUNT_KDF_NAME, type KdfParams } from "@/lib/vault/crypto";
import { createVaultInput, updateVaultInput } from "@/lib/vault/schemas";

/**
 * Coffre d'identité de l'utilisateur connecté. N'accepte et ne renvoie que
 * des blobs chiffrés dans le navigateur. Le coffre d'un autre utilisateur
 * n'est jamais adressable : sans coffre propre, la lecture renvoie `null`
 * (200, pour ne pas polluer la console à chaque page) et les écritures un 404.
 *
 * Les écritures exigent `Content-Type: application/json` (requête « non
 * simple » : un autre site ne peut pas l'émettre sans CORS). Rien n'est
 * journalisé hormis l'identifiant technique de l'utilisateur.
 */

const NO_STORE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function empty(status: number) {
  return new Response(null, { status, headers: NO_STORE });
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return undefined;
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * Un coffre « lié au compte » doit porter les paramètres du mot de passe
 * ACTUEL du compte : sinon le navigateur ne pourrait plus l'ouvrir.
 */
async function accountKdfMismatch(userId: string, kdf: KdfParams | undefined) {
  if (kdf?.name !== ACCOUNT_KDF_NAME) return false;
  const account = await accountKdf(userId);
  return !account || account.salt !== kdf.salt || account.iterations !== kdf.iterations;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return empty(401);
  const vault = await getVault(user.id);
  return json(vault);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return empty(401);
  const parsed = createVaultInput.safeParse(await readJson(request));
  if (!parsed.success) return empty(400);
  if (await accountKdfMismatch(user.id, parsed.data.kdf)) return empty(409);
  if (!(await createVault(user.id, parsed.data))) return empty(409);
  logger.info("vault.created", { userId: user.id });
  return json({ revision: 0 }, 201);
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return empty(401);
  const parsed = updateVaultInput.safeParse(await readJson(request));
  if (!parsed.success) return empty(400);
  if (await accountKdfMismatch(user.id, parsed.data.keys?.kdf)) return empty(409);
  const result = await updateVault(user.id, parsed.data);
  if (!result.ok) return empty(result.reason === "missing" ? 404 : 409);
  if (parsed.data.keys) logger.info("vault.passphrase_changed", { userId: user.id });
  return json({ revision: result.revision });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return empty(401);
  // Garde-fou contre une suppression déclenchée par erreur.
  const body = (await readJson(request)) as { confirm?: unknown } | undefined;
  if (body?.confirm !== true) return empty(400);
  if (!(await deleteVault(user.id))) return empty(404);
  logger.info("vault.deleted", { userId: user.id });
  return empty(204);
}
