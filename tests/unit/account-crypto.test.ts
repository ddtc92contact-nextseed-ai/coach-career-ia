import { beforeAll, describe, expect, it } from "vitest";
import { passwordStrength } from "@/lib/auth/password-strength";
import {
  createAccountVault,
  createVault,
  decryptJson,
  deriveAccountKeys,
  encryptJson,
  fromBase64,
  isAccountVault,
  matchesAccount,
  newAccountKdf,
  rewrapForAccount,
  unlockWithAccountKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  VaultDecryptError,
  VaultParamsError,
  type AccountKdf,
} from "@/lib/vault/crypto";
import { authHash as authHashSchema, createVaultInput } from "@/lib/vault/schemas";

const PASSWORD = "cheval correct pile agrafe";
const NEW_PASSWORD = "un tout autre mot de passe";
const identity = { firstName: "Camille", lastName: "Durand" };

describe(
  "compte : un seul mot de passe pour la connexion et le coffre",
  { timeout: 60_000 },
  () => {
    let kdf: AccountKdf;

    beforeAll(() => {
      kdf = newAccountKdf();
    });

    it("dérive un hash d'authentification stable, propre au mot de passe et au sel", async () => {
      expect(kdf.name).toBe("PBKDF2-SHA256");
      expect(kdf.iterations).toBeGreaterThanOrEqual(600_000);
      expect(fromBase64(kdf.salt)).toHaveLength(16);

      const a = await deriveAccountKeys(PASSWORD, kdf);
      const b = await deriveAccountKeys(PASSWORD, kdf);
      expect(a.authHash).toBe(b.authHash);
      expect(authHashSchema.safeParse(a.authHash).success).toBe(true);
      expect(fromBase64(a.authHash)).toHaveLength(32);
      // Ni le mot de passe ni la clé du coffre ne sont lisibles dans le hash.
      expect(a.authHash).not.toContain(PASSWORD);
      expect(Buffer.from(a.authHash, "base64").toString("latin1")).not.toContain("cheval");
      expect(a.vaultKey.extractable).toBe(false);

      expect((await deriveAccountKeys(NEW_PASSWORD, kdf)).authHash).not.toBe(a.authHash);
      expect((await deriveAccountKeys(PASSWORD, newAccountKdf())).authHash).not.toBe(a.authHash);
    });

    it("refuse des paramètres affaiblis", async () => {
      await expect(deriveAccountKeys(PASSWORD, { ...kdf, iterations: 1000 })).rejects.toThrow(
        VaultParamsError,
      );
      await expect(
        deriveAccountKeys(PASSWORD, { ...kdf, salt: "AAAA" } as AccountKdf),
      ).rejects.toThrow(VaultParamsError);
    });

    it("le hash d'authentification ne permet pas d'ouvrir le coffre", async () => {
      const keys = await deriveAccountKeys(PASSWORD, kdf);
      const { material } = await createAccountVault(keys.vaultKey, kdf);
      // Une clé AES construite à partir du hash (ce que voit le serveur) n'ouvre rien.
      const forged = await crypto.subtle.importKey(
        "raw",
        fromBase64(keys.authHash),
        { name: "AES-GCM" },
        false,
        ["wrapKey", "unwrapKey"],
      );
      await expect(unlockWithAccountKey(material, forged)).rejects.toThrow(VaultDecryptError);
    });

    it("coffre lié au compte : ouverture avec le mot de passe, refus avec un mauvais", async () => {
      const keys = await deriveAccountKeys(PASSWORD, kdf);
      const setup = await createAccountVault(keys.vaultKey, kdf);
      expect(isAccountVault(setup.material)).toBe(true);
      expect(matchesAccount(setup.material, kdf)).toBe(true);
      expect(createVaultInput.safeParse({ ...setup.material, identity: null }).success).toBe(true);
      const ciphertext = await encryptJson(setup.key, identity);

      const again = await deriveAccountKeys(PASSWORD, kdf);
      const key = await unlockWithAccountKey(setup.material, again.vaultKey);
      expect(await decryptJson(key, ciphertext)).toMatchObject(identity);

      const wrong = await deriveAccountKeys("mauvais mot de passe", kdf);
      await expect(unlockWithAccountKey(setup.material, wrong.vaultKey)).rejects.toThrow(
        VaultDecryptError,
      );
      // Une phrase secrète ne s'applique pas à un coffre lié au compte.
      await expect(unlockWithPassphrase(setup.material, PASSWORD)).rejects.toThrow(
        VaultParamsError,
      );
    });

    it("changement de mot de passe : ré-enveloppement sans rechiffrer les données", async () => {
      const current = await deriveAccountKeys(PASSWORD, kdf);
      const setup = await createAccountVault(current.vaultKey, kdf);
      const ciphertext = await encryptJson(setup.key, identity);

      const nextKdf = newAccountKdf();
      const next = await deriveAccountKeys(NEW_PASSWORD, nextKdf);
      const { material } = await rewrapForAccount(
        setup.material,
        { accountKey: current.vaultKey },
        next.vaultKey,
        nextKdf,
      );
      expect(material.recoveryWrappedKey).toBe(setup.material.recoveryWrappedKey);
      expect(matchesAccount(material, nextKdf)).toBe(true);
      expect(matchesAccount(material, kdf)).toBe(false);

      const reopened = await unlockWithAccountKey(material, next.vaultKey);
      expect(await decryptJson(reopened, ciphertext)).toMatchObject(identity);
      await expect(unlockWithAccountKey(material, current.vaultKey)).rejects.toThrow(
        VaultDecryptError,
      );
      // La clé de secours reste valable.
      const viaRecovery = await unlockWithRecoveryKey(material, setup.recoveryKey);
      expect(await decryptJson(viaRecovery, ciphertext)).toMatchObject(identity);

      // Mauvais mot de passe actuel : rien n'est ré-enveloppé.
      const wrong = await deriveAccountKeys("mauvais mot de passe", kdf);
      await expect(
        rewrapForAccount(setup.material, { accountKey: wrong.vaultKey }, next.vaultKey, nextKdf),
      ).rejects.toThrow(VaultDecryptError);
    });

    it("migration d'un ancien coffre à phrase secrète (phrase ou clé de secours)", async () => {
      const legacy = await createVault("ancienne phrase du coffre");
      const ciphertext = await encryptJson(legacy.key, identity);
      expect(isAccountVault(legacy.material)).toBe(false);
      const keys = await deriveAccountKeys(PASSWORD, kdf);

      await expect(
        rewrapForAccount(legacy.material, { passphrase: "pas la bonne" }, keys.vaultKey, kdf),
      ).rejects.toThrow(VaultDecryptError);

      const migrated = await rewrapForAccount(
        legacy.material,
        { passphrase: "ancienne phrase du coffre" },
        keys.vaultKey,
        kdf,
      );
      expect(matchesAccount(migrated.material, kdf)).toBe(true);
      expect(await decryptJson(migrated.key, ciphertext)).toMatchObject(identity);
      const reopened = await unlockWithAccountKey(migrated.material, keys.vaultKey);
      expect(await decryptJson(reopened, ciphertext)).toMatchObject(identity);
      await expect(
        unlockWithPassphrase(migrated.material, "ancienne phrase du coffre"),
      ).rejects.toThrow(VaultParamsError);

      const viaRecovery = await rewrapForAccount(
        legacy.material,
        { recoveryKey: legacy.recoveryKey },
        keys.vaultKey,
        kdf,
      );
      expect(await decryptJson(viaRecovery.key, ciphertext)).toMatchObject(identity);
    });

    it("après une réinitialisation, seul la clé de secours rouvre le coffre", async () => {
      const old = await deriveAccountKeys(PASSWORD, kdf);
      const setup = await createAccountVault(old.vaultKey, kdf);
      const ciphertext = await encryptJson(setup.key, identity);

      // Réinitialisation par e-mail : nouveau sel, le coffre n'a pas suivi.
      const resetKdf = newAccountKdf();
      const fresh = await deriveAccountKeys(NEW_PASSWORD, resetKdf);
      expect(matchesAccount(setup.material, resetKdf)).toBe(false);
      await expect(unlockWithAccountKey(setup.material, fresh.vaultKey)).rejects.toThrow(
        VaultDecryptError,
      );

      const recovered = await rewrapForAccount(
        setup.material,
        { recoveryKey: setup.recoveryKey },
        fresh.vaultKey,
        resetKdf,
      );
      expect(matchesAccount(recovered.material, resetKdf)).toBe(true);
      expect(await decryptJson(recovered.key, ciphertext)).toMatchObject(identity);
    });
  },
);

describe("robustesse du mot de passe", () => {
  it.each([
    ["court", "tooShort"],
    ["motdepasse12", "weak"],
    ["aaaaaaaaaaaaaaaa", "weak"],
    ["Zt9!kq2#Lm4p", "fair"],
    ["girafe orange tambour", "strong"],
    ["kumquat-velours-89!", "good"],
  ] as const)("%s → %s", (password, expected) => {
    expect(passwordStrength(password)).toBe(expected);
  });
});
