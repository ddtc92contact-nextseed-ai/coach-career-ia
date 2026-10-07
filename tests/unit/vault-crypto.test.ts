import { beforeAll, describe, expect, it } from "vitest";
import {
  changePassphrase,
  createVault,
  decryptFile,
  decryptJson,
  encryptFile,
  encryptJson,
  formatRecoveryKey,
  fromBase64,
  MIN_KDF_ITERATIONS,
  parseRecoveryKey,
  resetPassphraseWithRecoveryKey,
  toBase64,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  VaultDecryptError,
  VaultParamsError,
  type VaultMaterial,
  type VaultSetup,
} from "@/lib/vault/crypto";
import { employerForExperience, identityData } from "@/lib/vault/identity";
import { createVaultInput } from "@/lib/vault/schemas";

const PASSPHRASE = "cheval correct pile agrafe";
const identity = identityData.parse({
  firstName: "Camille",
  lastName: "Durand",
  email: "camille.durand@exemple.fr",
  phone: "06 12 34 56 78",
  employers: [{ experienceId: "exp_1", name: "Globex Corporation" }],
  schools: [{ name: "École Polytechnique" }],
  links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/camille-durand" }],
});

/** Altère un octet d'une valeur base64. */
function flip(value: string, index: number): string {
  const bytes = fromBase64(value);
  bytes[index] = bytes[index]! ^ 0x01;
  return toBase64(bytes);
}

describe("coffre d'identité : cryptographie navigateur", { timeout: 30_000 }, () => {
  let setup: VaultSetup;

  beforeAll(async () => {
    setup = await createVault(PASSPHRASE);
  });

  it("utilise PBKDF2-SHA256 ≥ 600 000 itérations et ne contient aucune clé en clair", () => {
    expect(setup.material.kdf.name).toBe("PBKDF2-SHA256");
    expect(setup.material.kdf.iterations).toBeGreaterThanOrEqual(600_000);
    expect(fromBase64(setup.material.kdf.salt)).toHaveLength(16);
    expect(setup.key.extractable).toBe(false);
    const serialized = JSON.stringify(setup.material);
    expect(serialized).not.toContain(PASSPHRASE);
    expect(serialized).not.toContain(setup.recoveryKey);
    // Le matériel envoyé au serveur respecte le contrat de l'API.
    expect(createVaultInput.safeParse({ ...setup.material, identity: null }).success).toBe(true);
  });

  it("chiffre puis déchiffre l'identité (aller-retour)", async () => {
    const ciphertext = await encryptJson(setup.key, identity);
    expect(ciphertext).not.toContain("Camille");
    expect(atob(ciphertext)).not.toContain("Durand");
    const key = await unlockWithPassphrase(setup.material, PASSPHRASE);
    expect(identityData.parse(await decryptJson(key, ciphertext))).toEqual(identity);
    expect(employerForExperience(identity, "exp_1")).toBe("Globex Corporation");
    expect(employerForExperience(identity, "exp_2")).toBeNull();
  });

  it("complète le clair : la taille du chiffré ne trahit pas la longueur des champs", async () => {
    const short = await encryptJson(setup.key, { ...identity, lastName: "Li" });
    const long = await encryptJson(setup.key, { ...identity, lastName: "Lindqvist-Montgomery" });
    expect(short.length).toBe(long.length);
  });

  it("deux chiffrements du même contenu diffèrent (IV aléatoire)", async () => {
    expect(await encryptJson(setup.key, identity)).not.toBe(await encryptJson(setup.key, identity));
  });

  it("refuse une mauvaise phrase secrète", async () => {
    await expect(unlockWithPassphrase(setup.material, "mauvaise phrase secrète")).rejects.toThrow(
      VaultDecryptError,
    );
  });

  it("déverrouille avec la clé de secours, saisie avec ou sans tirets ni casse", async () => {
    const ciphertext = await encryptJson(setup.key, identity);
    expect(setup.recoveryKey).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    const typed = setup.recoveryKey.toLowerCase().replace(/-/g, " ");
    const key = await unlockWithRecoveryKey(setup.material, typed);
    expect(await decryptJson(key, ciphertext)).toEqual(identity);
  });

  it("refuse une clé de secours fausse ou mal formée", async () => {
    const other = await createVault("une autre phrase longue");
    await expect(unlockWithRecoveryKey(setup.material, other.recoveryKey)).rejects.toThrow(
      VaultDecryptError,
    );
    await expect(unlockWithRecoveryKey(setup.material, "ABCD-1234")).rejects.toThrow(
      VaultDecryptError,
    );
  });

  it("encode la clé de secours sans perte", () => {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    expect(parseRecoveryKey(formatRecoveryKey(bytes))).toEqual(bytes);
  });

  it("change la phrase secrète sans rechiffrer les données", async () => {
    const ciphertext = await encryptJson(setup.key, identity);
    const next = await changePassphrase(setup.material, PASSPHRASE, "nouvelle phrase solide");
    expect(next.kdf.salt).not.toBe(setup.material.kdf.salt);
    expect(next.recoveryWrappedKey).toBe(setup.material.recoveryWrappedKey);
    const key = await unlockWithPassphrase(next, "nouvelle phrase solide");
    expect(await decryptJson(key, ciphertext)).toEqual(identity);
    await expect(unlockWithPassphrase(next, PASSPHRASE)).rejects.toThrow(VaultDecryptError);
    // La clé de secours reste valable après le changement.
    await expect(unlockWithRecoveryKey(next, setup.recoveryKey)).resolves.toBeDefined();
    // L'ancienne phrase est exigée.
    await expect(
      changePassphrase(setup.material, "pas la bonne phrase", "nouvelle phrase solide"),
    ).rejects.toThrow(VaultDecryptError);
  });

  it("redéfinit la phrase avec la clé de secours (phrase oubliée)", async () => {
    const ciphertext = await encryptJson(setup.key, identity);
    const next = await resetPassphraseWithRecoveryKey(
      setup.material,
      setup.recoveryKey,
      "phrase après récupération",
    );
    const key = await unlockWithPassphrase(next, "phrase après récupération");
    expect(await decryptJson(key, ciphertext)).toEqual(identity);
  });

  it("refuse une phrase trop courte", async () => {
    await expect(createVault("court")).rejects.toThrow(VaultParamsError);
    await expect(changePassphrase(setup.material, PASSPHRASE, "court")).rejects.toThrow(
      VaultParamsError,
    );
  });

  describe("détection d'altération", () => {
    it("rejette une identité chiffrée modifiée (en-tête, IV, corps ou tag)", async () => {
      const ciphertext = await encryptJson(setup.key, identity);
      const length = fromBase64(ciphertext).length;
      for (const index of [0, 5, 40, length - 1]) {
        await expect(decryptJson(setup.key, flip(ciphertext, index))).rejects.toThrow(
          VaultDecryptError,
        );
      }
      const truncated = toBase64(fromBase64(ciphertext).slice(0, 20));
      await expect(decryptJson(setup.key, truncated)).rejects.toThrow(VaultDecryptError);
    });

    it("rejette une clé enveloppée modifiée", async () => {
      const material: VaultMaterial = {
        ...setup.material,
        passphraseWrappedKey: flip(setup.material.passphraseWrappedKey, 30),
        recoveryWrappedKey: flip(setup.material.recoveryWrappedKey, 30),
      };
      await expect(unlockWithPassphrase(material, PASSPHRASE)).rejects.toThrow(VaultDecryptError);
      await expect(unlockWithRecoveryKey(material, setup.recoveryKey)).rejects.toThrow(
        VaultDecryptError,
      );
    });

    it("rejette un sel modifié et refuse des paramètres affaiblis", async () => {
      const salted = {
        ...setup.material,
        kdf: { ...setup.material.kdf, salt: flip(setup.material.kdf.salt, 0) },
      };
      await expect(unlockWithPassphrase(salted, PASSPHRASE)).rejects.toThrow(VaultDecryptError);
      const weak = {
        ...setup.material,
        kdf: { ...setup.material.kdf, iterations: MIN_KDF_ITERATIONS - 1 },
      };
      await expect(unlockWithPassphrase(weak, PASSPHRASE)).rejects.toThrow(VaultParamsError);
    });

    it("empêche de substituer une enveloppe à une autre (identité ↔ CV ↔ clés)", async () => {
      const cv = await encryptFile(setup.key, {
        name: "CV.pdf",
        type: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      });
      await expect(decryptJson(setup.key, toBase64(cv))).rejects.toThrow(VaultDecryptError);
      const swapped = {
        ...setup.material,
        passphraseWrappedKey: setup.material.recoveryWrappedKey,
      };
      await expect(unlockWithPassphrase(swapped, PASSPHRASE)).rejects.toThrow(VaultDecryptError);
    });

    it("rejette des données chiffrées avec la clé d'un autre coffre", async () => {
      const other = await createVault("phrase du second coffre");
      const ciphertext = await encryptJson(other.key, identity);
      await expect(decryptJson(setup.key, ciphertext)).rejects.toThrow(VaultDecryptError);
    });
  });

  it("chiffre le CV avec son nom et son type, et détecte toute altération", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 CV de Camille Durand");
    const file = { name: "CV Camille Durand.pdf", type: "application/pdf", bytes };
    const ciphertext = await encryptFile(setup.key, file);
    const raw = new TextDecoder("latin1").decode(ciphertext);
    expect(raw).not.toContain("Camille");
    expect(raw).not.toContain("application/pdf");
    expect(await decryptFile(setup.key, ciphertext)).toEqual(file);
    const tampered = ciphertext.slice();
    tampered[tampered.length - 5]! ^= 0xff;
    await expect(decryptFile(setup.key, tampered)).rejects.toThrow(VaultDecryptError);
  });
});
