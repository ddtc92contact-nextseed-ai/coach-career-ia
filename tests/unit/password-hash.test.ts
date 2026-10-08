import { describe, expect, it } from "vitest";
import { hashAuthHash, placeholderKdf, verifyAuthHash } from "@/lib/auth/password-hash";
import { accountKdfParams } from "@/lib/vault/schemas";

const AUTH_HASH = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 8).toString("base64");
const SECRET = "un-secret-de-test-suffisamment-long-0123456789";

describe("hachage serveur du hash d'authentification", { timeout: 30_000 }, () => {
  it("stocke un scrypt salé, versionné, qui ne contient pas le hash reçu", async () => {
    const stored = await hashAuthHash(AUTH_HASH);
    expect(stored).toMatch(/^scrypt\$15\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain(AUTH_HASH);
    // Sel aléatoire : deux hachages du même hash diffèrent.
    expect(await hashAuthHash(AUTH_HASH)).not.toBe(stored);
    expect(await verifyAuthHash(AUTH_HASH, stored)).toBe(true);
    expect(await verifyAuthHash(OTHER, stored)).toBe(false);
  });

  it("refuse un format inconnu", async () => {
    expect(await verifyAuthHash(AUTH_HASH, "")).toBe(false);
    expect(await verifyAuthHash(AUTH_HASH, `bcrypt$x$y`)).toBe(false);
  });

  it("paramètres factices : stables par adresse, indiscernables de vrais", () => {
    const a = placeholderKdf("alice@exemple.test", SECRET);
    expect(placeholderKdf("alice@exemple.test", SECRET)).toEqual(a);
    expect(placeholderKdf("bob@exemple.test", SECRET).salt).not.toBe(a.salt);
    expect(placeholderKdf("alice@exemple.test", `${SECRET}-autre`).salt).not.toBe(a.salt);
    expect(accountKdfParams.safeParse(a).success).toBe(true);
  });
});
