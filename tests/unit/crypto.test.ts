import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createKeyring,
  decrypt,
  DecryptionError,
  EncryptionConfigError,
  encrypt,
  keyringFromEnv,
  needsReEncryption,
} from "@/lib/crypto";

const newKey = () => randomBytes(32).toString("base64");

describe("lib/crypto", () => {
  const keyring = createKeyring({ currentKey: newKey() });

  it("chiffre puis déchiffre (aller-retour)", () => {
    const plaintext = "Directrice produit — Société Exemple, salaire 85 k€ ✓";
    const payload = encrypt(plaintext, { keyring });
    expect(payload).toMatch(/^v1:/);
    expect(payload).not.toContain("Exemple");
    expect(decrypt(payload, { keyring })).toBe(plaintext);
  });

  it("gère la chaîne vide", () => {
    expect(decrypt(encrypt("", { keyring }), { keyring })).toBe("");
  });

  it("produit un chiffré différent à chaque appel (IV aléatoire)", () => {
    expect(encrypt("même texte", { keyring })).not.toBe(encrypt("même texte", { keyring }));
  });

  it("échoue avec une mauvaise clé", () => {
    const payload = encrypt("secret", { keyring });
    const otherKeyring = createKeyring({ currentKey: newKey() });
    expect(() => decrypt(payload, { keyring: otherKeyring })).toThrow(DecryptionError);
  });

  it("échoue si le chiffré est altéré", () => {
    const payload = encrypt("secret de candidat", { keyring });
    const [version, iv, tag, ciphertext] = payload.split(":") as [string, string, string, string];
    const bytes = Buffer.from(ciphertext, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const tampered = [version, iv, tag, bytes.toString("base64url")].join(":");
    expect(() => decrypt(tampered, { keyring })).toThrow(DecryptionError);
  });

  it("échoue si le tag d'authentification est altéré", () => {
    const [version, iv, , ciphertext] = encrypt("x", { keyring }).split(":");
    const fakeTag = randomBytes(16).toString("base64url");
    expect(() => decrypt([version, iv, fakeTag, ciphertext].join(":"), { keyring })).toThrow(
      DecryptionError,
    );
  });

  it("échoue sur un format invalide sans divulguer de détail", () => {
    expect(() => decrypt("pas-un-chiffré", { keyring })).toThrow("Déchiffrement impossible");
  });

  it("lie le chiffré à son contexte (AAD)", () => {
    const payload = encrypt("jane@exemple.fr", { keyring, aad: "user:1:email" });
    expect(decrypt(payload, { keyring, aad: "user:1:email" })).toBe("jane@exemple.fr");
    expect(() => decrypt(payload, { keyring, aad: "user:2:email" })).toThrow(DecryptionError);
    expect(() => decrypt(payload, { keyring })).toThrow(DecryptionError);
  });

  it("refuse une version de clé falsifiée dans le chiffré", () => {
    const key = newKey();
    const rotated = createKeyring({ currentKey: key, currentVersion: 2, previousKeys: { 1: key } });
    const payload = encrypt("x", { keyring: rotated });
    expect(() => decrypt(payload.replace(/^v2:/, "v1:"), { keyring: rotated })).toThrow(
      DecryptionError,
    );
  });

  describe("rotation de clé", () => {
    const oldKey = newKey();
    const v1 = createKeyring({ currentKey: oldKey });
    const v2 = createKeyring({
      currentKey: newKey(),
      currentVersion: 2,
      previousKeys: { 1: oldKey },
    });

    it("déchiffre les anciens chiffrés avec l'ancienne clé", () => {
      const legacy = encrypt("ancien", { keyring: v1 });
      expect(decrypt(legacy, { keyring: v2 })).toBe("ancien");
      expect(needsReEncryption(legacy, { keyring: v2 })).toBe(true);
    });

    it("chiffre avec la clé courante", () => {
      const fresh = encrypt("nouveau", { keyring: v2 });
      expect(fresh).toMatch(/^v2:/);
      expect(needsReEncryption(fresh, { keyring: v2 })).toBe(false);
      expect(() => decrypt(fresh, { keyring: v1 })).toThrow(DecryptionError);
    });
  });

  describe("keyringFromEnv", () => {
    it("lit la clé courante, sa version et les anciennes clés", () => {
      const previous = newKey();
      const ring = keyringFromEnv({
        DATA_ENCRYPTION_KEY: newKey(),
        DATA_ENCRYPTION_KEY_VERSION: "3",
        DATA_ENCRYPTION_PREVIOUS_KEYS: `1:${previous}, 2:${newKey()}`,
      });
      expect(ring.currentVersion).toBe(3);
      expect([...ring.keys.keys()].sort()).toEqual([1, 2, 3]);
    });

    it("exige DATA_ENCRYPTION_KEY", () => {
      expect(() => keyringFromEnv({})).toThrow(EncryptionConfigError);
    });

    it("refuse une clé qui ne fait pas 32 octets", () => {
      expect(() => keyringFromEnv({ DATA_ENCRYPTION_KEY: "trop-courte" })).toThrow(
        EncryptionConfigError,
      );
    });
  });
});
