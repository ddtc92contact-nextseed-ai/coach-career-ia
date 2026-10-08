import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { AppLocale } from "@/i18n/routing";
import { db } from "@/lib/db";
import { recordTermsAcceptance } from "@/lib/legal/acceptance";
import { logger } from "@/lib/logger";
import { ACCOUNT_KDF_NAME, KDF_NAME, type AccountKdf } from "@/lib/vault/crypto";
import { sendAccountEmail } from "./mailer";
import { safeCallbackUrl } from "./redirect";
import { dummyPasswordHash, hashAuthHash, placeholderKdf, verifyAuthHash } from "./password-hash";
import { consumeToken, issueToken } from "./tokens";

/**
 * Comptes à e-mail + mot de passe, « zéro connaissance » : le serveur ne voit
 * jamais le mot de passe, seulement le hash d'authentification dérivé dans le
 * navigateur (`deriveAccountKeys`), qu'il hache encore (scrypt) avant de le
 * stocker. Aucune fonction ici ne journalise d'adresse, de hash ni de jeton.
 */

/** Durée d'une session (« rester connecté » : cookie persistant de même durée). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function kdfOf(user: { kdfIterations: number | null; kdfSalt: Uint8Array | null }) {
  if (!user.kdfIterations || !user.kdfSalt) return null;
  return { name: KDF_NAME, iterations: user.kdfIterations, salt: b64(user.kdfSalt) } as const;
}

function passwordData(authHashHash: string, kdf: AccountKdf, now: Date) {
  return {
    passwordHash: authHashHash,
    kdfIterations: kdf.iterations,
    kdfSalt: new Uint8Array(Buffer.from(kdf.salt, "base64")),
    passwordUpdatedAt: now,
  };
}

/**
 * Liens envoyés par e-mail : origine publique + langue de la page d'origine,
 * et destination après connexion (`/app` ou `/entreprise…`, validée).
 */
export type MailContext = { origin: string; locale: AppLocale; callbackUrl?: string };

const link = (ctx: MailContext, path: string) => `${ctx.origin}/${ctx.locale}${path}`;

/**
 * Paramètres de dérivation à utiliser pour se connecter avec cette adresse.
 * Sans compte à mot de passe, des paramètres factices stables : la réponse ne
 * révèle pas si le compte existe.
 */
export async function loginKdf(email: string, secret: string): Promise<AccountKdf> {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { passwordHash: true, kdfIterations: true, kdfSalt: true },
  });
  const kdf = user?.passwordHash ? kdfOf(user) : null;
  return kdf ?? placeholderKdf(normalizeEmail(email), secret);
}

/** Paramètres du compte connecté (`null` : pas encore de mot de passe). */
export async function accountKdf(userId: string): Promise<AccountKdf | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, kdfIterations: true, kdfSalt: true },
  });
  return user?.passwordHash ? kdfOf(user) : null;
}

// --- Inscription et vérification de l'adresse ---------------------------------------

/**
 * Crée un compte non vérifié et envoie le lien de vérification. Si l'adresse
 * a déjà un compte, rien n'est modifié : son titulaire reçoit un e-mail qui
 * l'invite à se connecter ou à réinitialiser son mot de passe. La réponse est
 * identique dans les deux cas (pas d'énumération des comptes).
 */
export async function signUp(
  input: { email: string; authHash: string; kdf: AccountKdf },
  ctx: MailContext,
  now: Date = new Date(),
): Promise<void> {
  const email = normalizeEmail(input.email);
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return notifyExisting(email, ctx);

  let userId: string;
  try {
    const user = await db.user.create({
      data: {
        email,
        locale: ctx.locale,
        ...passwordData(await hashAuthHash(input.authHash), input.kdf, now),
      },
      select: { id: true },
    });
    userId = user.id;
  } catch (error) {
    // Inscription simultanée avec la même adresse.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return notifyExisting(email, ctx);
    }
    throw error;
  }
  // La case « j'accepte » est obligatoire à l'inscription.
  await recordTermsAcceptance(userId, now);
  logger.info("auth.signup", { userId });
  await sendVerification(userId, email, ctx, now);
}

async function notifyExisting(email: string, ctx: MailContext) {
  await sendAccountEmail({
    to: email,
    kind: "accountExists",
    url: link(ctx, "/connexion"),
    extraUrl: link(ctx, "/connexion/mot-de-passe-oublie"),
    locale: ctx.locale,
  });
}

async function sendVerification(userId: string, email: string, ctx: MailContext, now: Date) {
  const token = await issueToken(userId, "VERIFY_EMAIL", now);
  const next = safeCallbackUrl(ctx.callbackUrl);
  const suffix = next === "/app" ? "" : `&callbackUrl=${encodeURIComponent(next)}`;
  await sendAccountEmail({
    to: email,
    kind: "verifyEmail",
    url: link(ctx, `/inscription/confirmer?token=${token}${suffix}`),
    locale: ctx.locale,
  });
}

/** Renvoie le lien de vérification si le compte existe et n'est pas vérifié. */
export async function resendVerification(email: string, ctx: MailContext): Promise<void> {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, email: true, emailVerified: true },
  });
  if (!user || user.emailVerified) return;
  await sendVerification(user.id, user.email, ctx, new Date());
}

/** Clic sur le lien de vérification : `true` si l'adresse est (désormais) vérifiée. */
export async function confirmEmail(token: string, now: Date = new Date()): Promise<boolean> {
  const userId = await consumeToken(token, "VERIFY_EMAIL", now);
  if (!userId) return false;
  await db.user.updateMany({
    where: { id: userId, emailVerified: null },
    data: { emailVerified: now },
  });
  logger.info("auth.email_verified", { userId });
  return true;
}

// --- Connexion ------------------------------------------------------------------------

export type CredentialsResult =
  { status: "ok"; userId: string } | { status: "invalid" } | { status: "unverified" };

/**
 * Vérifie le hash d'authentification. Adresse inconnue ou compte sans mot de
 * passe : même calcul (hachage factice) et même réponse qu'un mauvais mot de
 * passe. « Non vérifié » n'est renvoyé qu'avec le bon mot de passe.
 */
export async function verifyCredentials(
  email: string,
  authHash: string,
): Promise<CredentialsResult> {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, passwordHash: true, emailVerified: true },
  });
  const ok = await verifyAuthHash(authHash, user?.passwordHash ?? (await dummyPasswordHash()));
  if (!user?.passwordHash || !ok) return { status: "invalid" };
  if (!user.emailVerified) return { status: "unverified" };
  return { status: "ok", userId: user.id };
}

/** Mot de passe du compte connecté correct ? */
export async function checkPassword(userId: string, authHash: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user?.passwordHash) return false;
  return verifyAuthHash(authHash, user.passwordHash);
}

/** Ouvre une session en base (lue ensuite par Auth.js comme une session de lien magique). */
export async function createSession(userId: string, now: Date = new Date()) {
  const sessionToken = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.session.create({ data: { sessionToken, userId, expires } });
  // Comme à chaque connexion : version des conditions affichées sous le formulaire.
  if (await recordTermsAcceptance(userId, now)) {
    logger.info("legal.terms.accepted", { userId });
  }
  return { sessionToken, expires };
}

// --- Mot de passe oublié --------------------------------------------------------------

/** Envoie un lien de réinitialisation (30 min) si un compte existe. Réponse toujours identique. */
export async function requestPasswordReset(email: string, ctx: MailContext): Promise<void> {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, email: true },
  });
  if (!user) return;
  const token = await issueToken(user.id, "RESET_PASSWORD");
  await sendAccountEmail({
    to: user.email,
    kind: "resetPassword",
    url: link(ctx, `/connexion/nouveau-mot-de-passe?token=${token}`),
    locale: ctx.locale,
  });
  logger.info("auth.password_reset.requested", { userId: user.id });
}

/**
 * Nouveau mot de passe via le lien reçu par e-mail. Le jeton est consommé,
 * l'adresse est considérée vérifiée et toutes les sessions sont fermées.
 *
 * Le coffre d'identité n'est PAS ré-enveloppé (le serveur ne le peut pas) :
 * il reste lié à l'ancien mot de passe et ne se rouvrira qu'avec la clé de
 * secours. La mémoire de carrière, les contacts, etc. ne sont pas touchés.
 */
export async function resetPassword(
  input: { token: string; authHash: string; kdf: AccountKdf },
  now: Date = new Date(),
): Promise<string | null> {
  const userId = await consumeToken(input.token, "RESET_PASSWORD", now);
  if (!userId) return null;
  const data = passwordData(await hashAuthHash(input.authHash), input.kdf, now);
  await db.$transaction([
    db.user.update({ where: { id: userId }, data }),
    db.user.updateMany({
      where: { id: userId, emailVerified: null },
      data: { emailVerified: now },
    }),
    db.session.deleteMany({ where: { userId } }),
  ]);
  logger.info("auth.password_reset.done", { userId });
  return userId;
}

// --- Définition et changement du mot de passe (connecté) ----------------------------

export type SetPasswordInput = {
  /** Absent seulement pour un premier mot de passe (compte à lien magique). */
  currentAuthHash?: string;
  authHash: string;
  kdf: AccountKdf;
  /** Clé du coffre ré-enveloppée dans le navigateur avec le nouveau mot de passe. */
  vault?: { revision: number; wrappedKey: string };
};

export type SetPasswordResult =
  | { ok: true; vaultRevision: number | null }
  | { ok: false; reason: "invalidCurrent" | "currentRequired" | "vaultConflict" };

/**
 * Le coffre lié à l'ancien mot de passe DOIT être ré-enveloppé dans la même
 * transaction (sinon il deviendrait illisible) : à défaut, `vaultConflict`.
 * Les autres sessions du compte sont fermées.
 */
export async function setPassword(
  userId: string,
  input: SetPasswordInput,
  keepSessionToken?: string,
  now: Date = new Date(),
): Promise<SetPasswordResult> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true, kdfIterations: true, kdfSalt: true },
  });
  if (user.passwordHash) {
    if (!input.currentAuthHash) return { ok: false, reason: "currentRequired" };
    if (!(await verifyAuthHash(input.currentAuthHash, user.passwordHash))) {
      return { ok: false, reason: "invalidCurrent" };
    }
  }
  const previous = kdfOf(user);
  const data = passwordData(await hashAuthHash(input.authHash), input.kdf, now);

  try {
    const vaultRevision = await db.$transaction(async (tx) => {
      const vault = await tx.identityVault.findUnique({
        where: { userId },
        select: { kdfName: true, kdfIterations: true, kdfSalt: true, revision: true },
      });
      const boundToPrevious =
        vault !== null &&
        previous !== null &&
        vault.kdfName === ACCOUNT_KDF_NAME &&
        vault.kdfIterations === previous.iterations &&
        b64(vault.kdfSalt) === previous.salt;
      // Un coffre lié à l'ancien mot de passe doit suivre ; aucun autre n'est touché.
      if (boundToPrevious !== Boolean(input.vault)) throw new VaultConflict();
      let revision: number | null = null;
      if (input.vault) {
        const { count } = await tx.identityVault.updateMany({
          where: { userId, revision: input.vault.revision },
          data: {
            revision: { increment: 1 },
            kdfName: ACCOUNT_KDF_NAME,
            kdfIterations: input.kdf.iterations,
            kdfSalt: data.kdfSalt,
            passphraseWrappedKey: new Uint8Array(Buffer.from(input.vault.wrappedKey, "base64")),
          },
        });
        if (count !== 1) throw new VaultConflict();
        revision = input.vault.revision + 1;
      }
      await tx.user.update({ where: { id: userId }, data });
      await tx.session.deleteMany({
        where: { userId, ...(keepSessionToken ? { sessionToken: { not: keepSessionToken } } : {}) },
      });
      return revision;
    });
    logger.info(previous ? "auth.password_changed" : "auth.password_set", { userId });
    return { ok: true, vaultRevision };
  } catch (error) {
    if (error instanceof VaultConflict) return { ok: false, reason: "vaultConflict" };
    throw error;
  }
}

class VaultConflict extends Error {}
