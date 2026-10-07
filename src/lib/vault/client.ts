import {
  changePassphrase,
  createVault,
  decryptFile,
  decryptJson,
  encryptFile,
  encryptJson,
  resetPassphraseWithRecoveryKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type VaultFile,
  type VaultMaterial,
} from "./crypto";
import { emptyIdentity, identityData, type IdentityData } from "./identity";
import type { VaultResponse } from "./schemas";

/**
 * Client navigateur du coffre : chiffre/déchiffre localement, puis échange
 * uniquement des blobs opaques avec `/api/vault`. Aucune phrase, clé ni
 * donnée en clair n'est placée dans une requête.
 */

export class VaultHttpError extends Error {
  constructor(readonly status: number) {
    super(`Erreur ${status}`);
    this.name = "VaultHttpError";
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Coffre déverrouillé, tenu en mémoire uniquement. */
export type UnlockedVault = {
  key: CryptoKey;
  material: VaultMaterial;
  revision: number;
  identity: IdentityData;
  hasCv: boolean;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

export function createVaultClient(fetcher: Fetch = (input, init) => fetch(input, init)) {
  const call = async (path: string, init?: RequestInit) => {
    const response = await fetcher(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
    });
    if (!response.ok) throw new VaultHttpError(response.status);
    return response;
  };

  const materialOf = (vault: VaultResponse): VaultMaterial => ({
    version: vault.version,
    kdf: vault.kdf,
    passphraseWrappedKey: vault.passphraseWrappedKey,
    recoveryWrappedKey: vault.recoveryWrappedKey,
  });

  async function open(vault: VaultResponse, key: CryptoKey): Promise<UnlockedVault> {
    const identity = vault.identity
      ? identityData.parse(await decryptJson(key, vault.identity))
      : emptyIdentity();
    return {
      key,
      material: materialOf(vault),
      revision: vault.revision,
      identity,
      hasCv: vault.hasCv,
    };
  }

  return {
    /** Coffre chiffré de l'utilisateur, ou `null` s'il n'en a pas encore. */
    async fetch(): Promise<VaultResponse | null> {
      try {
        return (await (await call("/api/vault")).json()) as VaultResponse;
      } catch (error) {
        if (error instanceof VaultHttpError && error.status === 404) return null;
        throw error;
      }
    },

    /** Crée le coffre ; renvoie la clé de secours, à montrer une seule fois. */
    async setup(passphrase: string, identity: IdentityData = emptyIdentity()) {
      const { material, key, recoveryKey } = await createVault(passphrase);
      const encrypted = await encryptJson(key, identity);
      await call("/api/vault", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...material, identity: encrypted }),
      });
      const vault: UnlockedVault = { key, material, revision: 0, identity, hasCv: false };
      return { vault, recoveryKey };
    },

    async unlock(vault: VaultResponse, passphrase: string): Promise<UnlockedVault> {
      return open(vault, await unlockWithPassphrase(materialOf(vault), passphrase));
    },

    /** Phrase oubliée : clé de secours + nouvelle phrase. */
    async recover(
      vault: VaultResponse,
      recoveryKey: string,
      newPassphrase: string,
    ): Promise<UnlockedVault> {
      const material = materialOf(vault);
      const key = await unlockWithRecoveryKey(material, recoveryKey);
      const next = await resetPassphraseWithRecoveryKey(material, recoveryKey, newPassphrase);
      const revision = await this.putKeys(vault.revision, next);
      return { ...(await open(vault, key)), material: next, revision };
    },

    async changePassphrase(
      vault: UnlockedVault,
      currentPassphrase: string,
      newPassphrase: string,
    ): Promise<UnlockedVault> {
      const next = await changePassphrase(vault.material, currentPassphrase, newPassphrase);
      const revision = await this.putKeys(vault.revision, next);
      return { ...vault, material: next, revision };
    },

    async putKeys(revision: number, material: VaultMaterial): Promise<number> {
      const response = await call("/api/vault", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          revision,
          keys: { kdf: material.kdf, passphraseWrappedKey: material.passphraseWrappedKey },
        }),
      });
      return ((await response.json()) as { revision: number }).revision;
    },

    async saveIdentity(vault: UnlockedVault, identity: IdentityData): Promise<UnlockedVault> {
      const clean = identityData.parse(identity);
      const response = await call("/api/vault", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          revision: vault.revision,
          identity: await encryptJson(vault.key, clean),
        }),
      });
      const { revision } = (await response.json()) as { revision: number };
      return { ...vault, identity: clean, revision };
    },

    async uploadCv(vault: UnlockedVault, file: VaultFile): Promise<UnlockedVault> {
      await call("/api/vault/cv", {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: await encryptFile(vault.key, file),
      });
      return { ...vault, hasCv: true };
    },

    async downloadCv(vault: UnlockedVault): Promise<VaultFile> {
      const response = await call("/api/vault/cv");
      return decryptFile(vault.key, new Uint8Array(await response.arrayBuffer()));
    },

    async deleteCv(vault: UnlockedVault): Promise<UnlockedVault> {
      await call("/api/vault/cv", { method: "DELETE" });
      return { ...vault, hasCv: false };
    },

    /** Supprime définitivement le coffre (identité et CV). */
    async destroy(): Promise<void> {
      await call("/api/vault", {
        method: "DELETE",
        headers: JSON_HEADERS,
        body: JSON.stringify({ confirm: true }),
      });
    },
  };
}

export type VaultClient = ReturnType<typeof createVaultClient>;
