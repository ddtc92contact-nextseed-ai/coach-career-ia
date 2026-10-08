import {
  deriveAccountKeys,
  matchesAccount,
  newAccountKdf,
  rewrapForAccount,
  VaultDecryptError,
  type AccountKdf,
  type VaultMaterial,
} from "@/lib/vault/crypto";

/**
 * Client navigateur des comptes à mot de passe. Le mot de passe ne sort
 * jamais de ce module : seul le hash d'authentification dérivé
 * (`deriveAccountKeys`) est envoyé, avec les paramètres de dérivation.
 */

export type AccountErrorCode =
  | "invalidCredentials"
  | "unverified"
  | "rateLimited"
  | "invalidToken"
  | "invalidCurrent"
  | "currentRequired"
  | "vaultConflict"
  | "invalidInput"
  | "invalidEmail"
  | "generic";

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    readonly status: number,
    readonly retryAfterSeconds = 0,
  ) {
    super(code);
    this.name = "AccountError";
  }
}

/** Clé du coffre dérivée du mot de passe, gardée en mémoire seulement. */
export type AccountKey = { vaultKey: CryptoKey; kdf: AccountKdf };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const KNOWN: readonly AccountErrorCode[] = [
  "invalidCredentials",
  "unverified",
  "rateLimited",
  "invalidToken",
  "invalidCurrent",
  "currentRequired",
  "vaultConflict",
  "invalidInput",
  "invalidEmail",
];

export function createAccountClient(fetcher: Fetch = (input, init) => fetch(input, init)) {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetcher(path, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const data = (await response.json().catch(() => null)) as
      (T & { error?: string; retryAfterSeconds?: number }) | null;
    if (!response.ok) {
      const code = KNOWN.find((c) => c === data?.error) ?? "generic";
      throw new AccountError(code, response.status, data?.retryAfterSeconds ?? 0);
    }
    return data as T;
  }

  return {
    /**
     * Connexion : paramètres du compte → dérivation locale → envoi du seul
     * hash d'authentification. Renvoie la clé du coffre (mémoire seulement).
     */
    async login(email: string, password: string, remember: boolean): Promise<AccountKey> {
      const { kdf } = await call<{ kdf: AccountKdf }>("/api/account/prelogin", { email });
      const keys = await deriveAccountKeys(password, kdf);
      await call("/api/account/login", { email, authHash: keys.authHash, remember });
      return { vaultKey: keys.vaultKey, kdf };
    },

    async signup(
      email: string,
      password: string,
      locale: string,
      callbackUrl?: string,
    ): Promise<void> {
      const kdf = newAccountKdf();
      const { authHash } = await deriveAccountKeys(password, kdf);
      await call("/api/account/signup", {
        email,
        authHash,
        kdf,
        acceptTerms: true,
        locale,
        ...(callbackUrl ? { callbackUrl } : {}),
      });
    },

    async resendVerification(email: string, locale: string): Promise<void> {
      await call("/api/account/verify", { email, locale });
    },

    async requestReset(email: string, locale: string): Promise<void> {
      await call("/api/account/reset/request", { email, locale });
    },

    async resetPassword(token: string, password: string): Promise<void> {
      const kdf = newAccountKdf();
      const { authHash } = await deriveAccountKeys(password, kdf);
      await call("/api/account/reset", { token, authHash, kdf });
    },

    /** Paramètres du compte connecté (`null` : pas de mot de passe). */
    async accountKdf(): Promise<AccountKdf | null> {
      return (await call<{ kdf: AccountKdf | null }>("/api/account/password")).kdf;
    },

    /**
     * Clé du coffre dérivée d'un mot de passe saisi. Avec `verify`, le serveur
     * confirme d'abord le mot de passe (hash d'authentification) : obligatoire
     * avant d'envelopper le coffre avec cette clé.
     */
    async deriveKey(password: string, kdf: AccountKdf, verify: boolean): Promise<AccountKey> {
      const keys = await deriveAccountKeys(password, kdf);
      if (verify) await call("/api/account/password/verify", { authHash: keys.authHash });
      return { vaultKey: keys.vaultKey, kdf };
    },

    /**
     * Définit ou change le mot de passe. Si le coffre est lié au mot de passe
     * actuel, sa clé est ré-enveloppée ici, avec le nouveau, et envoyée dans
     * la même requête (le serveur ne voit que l'enveloppe).
     */
    async setPassword(input: {
      current: string | null;
      next: string;
      vault: { material: VaultMaterial; revision: number } | null;
    }): Promise<{ key: AccountKey; vault: { material: VaultMaterial; revision: number } | null }> {
      const currentKdf = await this.accountKdf();
      if (currentKdf && !input.current) throw new AccountError("currentRequired", 403);
      const current =
        currentKdf && input.current ? await deriveAccountKeys(input.current, currentKdf) : null;
      const kdf = newAccountKdf();
      const next = await deriveAccountKeys(input.next, kdf);

      let vault: { material: VaultMaterial; revision: number } | null = null;
      if (
        current &&
        currentKdf &&
        input.vault &&
        matchesAccount(input.vault.material, currentKdf)
      ) {
        try {
          const { material } = await rewrapForAccount(
            input.vault.material,
            { accountKey: current.vaultKey },
            next.vaultKey,
            kdf,
          );
          vault = { material, revision: input.vault.revision };
        } catch (error) {
          // Le mot de passe actuel n'ouvre pas le coffre : il est faux.
          if (error instanceof VaultDecryptError) throw new AccountError("invalidCurrent", 403);
          throw error;
        }
      }
      const result = await call<{ vaultRevision: number | null }>("/api/account/password", {
        ...(current ? { currentAuthHash: current.authHash } : {}),
        authHash: next.authHash,
        kdf,
        ...(vault
          ? { vault: { revision: vault.revision, wrappedKey: vault.material.passphraseWrappedKey } }
          : {}),
      });
      return {
        key: { vaultKey: next.vaultKey, kdf },
        vault:
          vault && result.vaultRevision !== null
            ? { material: vault.material, revision: result.vaultRevision }
            : null,
      };
    },
  };
}

export type AccountClient = ReturnType<typeof createAccountClient>;

/**
 * Clé de message d'une erreur de formulaire : le code renvoyé par le serveur
 * s'il fait partie de `known`, sinon `rateLimited`, `network` ou `generic`.
 * `minutes` : attente avant un nouvel essai (429).
 */
export function accountErrorKey<K extends AccountErrorCode>(
  error: unknown,
  known: readonly K[],
): { key: K | "rateLimited" | "network" | "generic"; minutes: number } {
  if (error instanceof AccountError) {
    if (error.code === "rateLimited") {
      return { key: "rateLimited", minutes: Math.max(1, Math.ceil(error.retryAfterSeconds / 60)) };
    }
    const match = known.find((code) => code === error.code);
    return { key: match ?? "generic", minutes: 0 };
  }
  // `fetch` rejette par une TypeError quand le réseau est indisponible.
  if (error instanceof TypeError) return { key: "network", minutes: 0 };
  return { key: "generic", minutes: 0 };
}
