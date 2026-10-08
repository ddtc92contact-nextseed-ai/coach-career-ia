import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { DEFAULT_KDF_ITERATIONS, KDF_NAME, type AccountKdf } from "@/lib/vault/crypto";

/**
 * Hachage lent, côté serveur, du hash d'authentification reçu du navigateur
 * (jamais le mot de passe lui-même : voir `deriveAccountKeys`). scrypt
 * (N = 2^15, r = 8, p = 3 : un des réglages recommandés par l'OWASP), sel
 * aléatoire de 16 octets. Format stocké, versionné pour pouvoir durcir les
 * paramètres : `scrypt$<log2 N>$<r>$<p>$<sel base64>$<hash base64>`.
 */

const LOG_N = 15;
const R = 8;
const P = 3;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(secret: Buffer, salt: Buffer, logN: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(secret, salt, KEY_LENGTH, { N: 2 ** logN, r, p, maxmem: MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashAuthHash(authHash: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(Buffer.from(authHash, "base64"), salt, LOG_N, R, P);
  return ["scrypt", LOG_N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Comparaison en temps constant. Un format inconnu ne correspond jamais. */
export async function verifyAuthHash(authHash: string, stored: string): Promise<boolean> {
  const [scheme, logN, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(
    Buffer.from(authHash, "base64"),
    Buffer.from(salt, "base64"),
    Number(logN),
    Number(r),
    Number(p),
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hachage factice : même durée de vérification pour une adresse inconnue. */
let dummy: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashAuthHash(randomBytes(32).toString("base64"));
  return dummy;
}

/**
 * Paramètres de dérivation renvoyés pour une adresse sans mot de passe
 * (inconnue, ou compte à lien magique) : un sel stable déduit de l'adresse et
 * du secret du serveur, indiscernable d'un vrai sel. Évite qu'on puisse
 * tester l'existence d'un compte avant la connexion.
 */
export function placeholderKdf(email: string, secret: string): AccountKdf {
  const salt = createHmac("sha256", secret)
    .update(`kdf-salt:${email}`)
    .digest()
    .subarray(0, 16)
    .toString("base64");
  return { name: KDF_NAME, iterations: DEFAULT_KDF_ITERATIONS, salt };
}
