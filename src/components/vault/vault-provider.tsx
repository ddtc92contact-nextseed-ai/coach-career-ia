"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createAccountClient, type AccountKey } from "@/lib/auth/account-client";
import { dropAccountKey, takeAccountKey } from "@/lib/auth/key-handoff";
import {
  createVaultClient,
  VaultConflictError,
  VaultHttpError,
  type UnlockedVault,
} from "@/lib/vault/client";
import {
  isAccountVault,
  matchesAccount,
  type AccountKdf,
  type VaultFile,
  type VaultMaterial,
} from "@/lib/vault/crypto";
import type { IdentityData } from "@/lib/vault/identity";
import type { VaultResponse } from "@/lib/vault/schemas";

/**
 * État du coffre d'identité pour tout l'espace `/app`.
 *
 * La clé de données déverrouillée et l'identité déchiffrée ne vivent que dans
 * cet état React (mémoire de l'onglet) : jamais dans localStorage,
 * sessionStorage, IndexedDB ni un cookie. Elles sont effacées au verrouillage,
 * à la déconnexion, au rechargement de la page et après une période
 * d'inactivité réglable. Seule la durée choisie est mémorisée localement
 * (préférence non identifiante).
 *
 * Un seul mot de passe : la clé dérivée du mot de passe du compte (« clé du
 * compte ») enveloppe la clé du coffre. Transmise par la page de connexion
 * (`takeAccountKey`), elle ouvre le coffre dès l'arrivée dans l'espace. Elle
 * suit les mêmes règles d'effacement que la clé de données.
 *
 * États :
 * - `none` : pas encore de coffre ;
 * - `locked` : coffre fermé (mot de passe du compte, ou ancienne phrase
 *   secrète pour un compte sans mot de passe) ;
 * - `legacy` : ancien coffre à phrase secrète, à lier au mot de passe du
 *   compte (une seule fois, avec l'ancienne phrase ou la clé de secours) ;
 * - `stale` : le mot de passe a été réinitialisé par e-mail : le coffre ne
 *   s'ouvre plus qu'avec la clé de secours ;
 * - `unlocked`.
 */

export type VaultStatus = "loading" | "error" | "none" | "locked" | "legacy" | "stale" | "unlocked";

/** État d'un coffre fermé selon son enveloppe et le mot de passe du compte. */
export function closedStatus(
  stored: Pick<VaultMaterial, "kdf"> | null,
  account: AccountKdf | null,
): Exclude<VaultStatus, "loading" | "error" | "unlocked"> {
  if (!stored) return "none";
  if (isAccountVault(stored))
    return account && matchesAccount(stored, account) ? "locked" : "stale";
  return account ? "legacy" : "locked";
}

export const IDLE_CHOICES = [5, 15, 30, 60] as const;
const IDLE_STORAGE_KEY = "ccia.vault.idle-minutes";
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

function defaultIdleMinutes(): number {
  const fromEnv = Number(process.env.NEXT_PUBLIC_VAULT_IDLE_MINUTES);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 15;
}

function readIdlePreference(): number | null {
  try {
    const value = Number(window.localStorage.getItem(IDLE_STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

type VaultContextValue = {
  status: VaultStatus;
  /** Le compte a un mot de passe (sinon : connexion par lien magique uniquement). */
  hasPassword: boolean;
  /** La clé du compte est en mémoire : pas besoin de redemander le mot de passe. */
  hasAccountKey: boolean;
  /** Identité déchiffrée, `null` tant que le coffre est verrouillé. */
  identity: IdentityData | null;
  hasCv: boolean;
  idleMinutes: number;
  setIdleMinutes: (minutes: number) => void;
  reload: () => Promise<void>;
  /**
   * Crée le coffre (lié au mot de passe du compte) et renvoie la clé de
   * secours (à montrer une seule fois). Le mot de passe n'est demandé que si
   * la clé du compte n'est plus en mémoire.
   */
  setup: (password?: string) => Promise<string>;
  /** Ouvre un coffre lié au compte avec le mot de passe du compte. */
  unlockWithPassword: (password: string) => Promise<void>;
  /** États `legacy` et `stale` : lie le coffre au mot de passe actuel du compte. */
  bindToAccount: (
    secret: { passphrase: string } | { recoveryKey: string },
    password?: string,
  ) => Promise<void>;
  /** Définit ou change le mot de passe du compte (coffre ré-enveloppé localement). */
  changePassword: (current: string | null, next: string) => Promise<void>;
  /** Compte sans mot de passe : ancienne phrase secrète du coffre. */
  unlock: (passphrase: string) => Promise<void>;
  recover: (recoveryKey: string, newPassphrase: string) => Promise<void>;
  lock: () => void;
  saveIdentity: (identity: IdentityData) => Promise<void>;
  changePassphrase: (current: string, next: string) => Promise<void>;
  uploadCv: (file: VaultFile) => Promise<void>;
  downloadCv: () => Promise<VaultFile>;
  deleteCv: () => Promise<void>;
  destroy: () => Promise<void>;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createVaultClient(), []);
  const accounts = useMemo(() => createAccountClient(), []);
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [stored, setStored] = useState<VaultResponse | null>(null);
  const [vault, setVault] = useState<UnlockedVault | null>(null);
  const [account, setAccount] = useState<AccountKdf | null>(null);
  const [accountKey, setAccountKey] = useState<AccountKey | null>(null);
  const [idleMinutes, setIdleState] = useState(defaultIdleMinutes);
  const vaultRef = useRef<UnlockedVault | null>(null);
  const accountKeyRef = useRef<AccountKey | null>(null);
  const storedRef = useRef<VaultResponse | null>(null);
  const accountRef = useRef<AccountKdf | null>(null);

  const apply = useCallback((next: UnlockedVault | null) => {
    vaultRef.current = next;
    setVault(next);
  }, []);

  const keep = useCallback((next: AccountKey | null) => {
    accountKeyRef.current = next;
    setAccountKey(next);
  }, []);

  const lock = useCallback(() => {
    apply(null);
    keep(null);
    dropAccountKey();
    setStatus((current) =>
      current === "unlocked" ? closedStatus(storedRef.current, accountRef.current) : current,
    );
  }, [apply, keep]);

  const reload = useCallback(async () => {
    try {
      const [next, kdf] = await Promise.all([client.fetch(), accounts.accountKdf()]);
      setStored(next);
      storedRef.current = next;
      setAccount(kdf);
      accountRef.current = kdf;
      // Clé d'un ancien mot de passe (changé ailleurs) : inutilisable.
      const key = accountKeyRef.current;
      if (key && (!kdf || key.kdf.salt !== kdf.salt)) keep(null);
      if (!next) {
        apply(null);
        setStatus("none");
        return;
      }
      if (vaultRef.current) return;
      const closed = closedStatus(next, kdf);
      if (closed === "locked" && isAccountVault(next) && accountKeyRef.current) {
        try {
          apply(await client.unlockWithAccount(next, accountKeyRef.current.vaultKey));
          setStatus("unlocked");
          return;
        } catch {
          keep(null);
        }
      }
      setStatus(closed);
    } catch {
      setStatus("error");
    }
  }, [client, accounts, apply, keep]);

  useEffect(() => {
    // Préférence locale lue après l'hydratation (absente du rendu serveur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdleState((current) => readIdlePreference() ?? current);
    // Clé transmise par la page de connexion : le coffre s'ouvre sans second mot de passe.
    const handedOff = takeAccountKey();
    if (handedOff) keep(handedOff);
    void reload();
  }, [reload, keep]);

  // Verrouillage automatique après inactivité (y compris onglet en arrière-plan).
  useEffect(() => {
    if (!vault && !accountKey) return;
    const limit = idleMinutes * 60_000;
    let last = Date.now();
    let timer = window.setTimeout(lock, limit);
    const onActivity = () => {
      last = Date.now();
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, limit);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= limit) lock();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [vault, accountKey, idleMinutes, lock]);

  // Clés effacées de la mémoire dès que l'espace candidat est quitté.
  useEffect(
    () => () => {
      apply(null);
      keep(null);
    },
    [apply, keep],
  );

  /** Clé du compte en mémoire, ou dérivée du mot de passe fourni. */
  const resolveAccountKey = useCallback(
    async (password: string | undefined, verify: boolean): Promise<AccountKey> => {
      const kdf = accountRef.current;
      if (!kdf) throw new Error("Aucun mot de passe");
      if (accountKeyRef.current && accountKeyRef.current.kdf.salt === kdf.salt) {
        return accountKeyRef.current;
      }
      if (!password) throw new Error("Mot de passe requis");
      return accounts.deriveKey(password, kdf, verify);
    },
    [accounts],
  );

  const current = useCallback(() => {
    if (!vaultRef.current) throw new Error("Coffre verrouillé");
    return vaultRef.current;
  }, []);

  /**
   * Après un 409 : relit le coffre, le déchiffre avec la clé en mémoire et
   * remplace la révision, l'identité et le matériel de clés périmés, puis
   * relance l'erreur sous forme de `VaultConflictError` (identité à jour).
   */
  const withConflictReload = useCallback(
    async (task: () => Promise<UnlockedVault>) => {
      try {
        apply(await task());
      } catch (error) {
        if (!(error instanceof VaultHttpError) || error.status !== 409) throw error;
        const key = vaultRef.current?.key;
        const latest = await client.fetch();
        setStored(latest);
        storedRef.current = latest;
        if (!latest) {
          apply(null);
          setStatus("none");
          throw new VaultConflictError(null);
        }
        if (!key) throw new VaultConflictError(null);
        try {
          const fresh = await client.reopen(latest, key);
          apply(fresh);
          throw new VaultConflictError(fresh.identity);
        } catch (reopenError) {
          if (reopenError instanceof VaultConflictError) throw reopenError;
          // Coffre recréé ailleurs avec une autre clé : on reverrouille.
          lock();
          throw new VaultConflictError(null);
        }
      }
    },
    [client, apply, lock],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      status,
      hasPassword: account !== null,
      hasAccountKey: accountKey !== null,
      identity: vault?.identity ?? null,
      hasCv: vault?.hasCv ?? stored?.hasCv ?? false,
      idleMinutes,
      setIdleMinutes: (minutes) => {
        setIdleState(minutes);
        try {
          window.localStorage.setItem(IDLE_STORAGE_KEY, String(minutes));
        } catch {
          // Stockage indisponible : la durée vaut pour cette session seulement.
        }
      },
      reload,
      setup: async (password) => {
        const key = await resolveAccountKey(password, true);
        const { vault: created, recoveryKey } = await client.setupWithAccount(
          key.vaultKey,
          key.kdf,
        );
        keep(key);
        apply(created);
        setStatus("unlocked");
        await reload();
        return recoveryKey;
      },
      unlockWithPassword: async (password) => {
        if (!stored) throw new Error("Aucun coffre");
        // L'ouverture de l'enveloppe suffit à vérifier le mot de passe.
        const key = await resolveAccountKey(password, false);
        apply(await client.unlockWithAccount(stored, key.vaultKey));
        keep(key);
        setStatus("unlocked");
      },
      bindToAccount: async (secret, password) => {
        if (!stored) throw new Error("Aucun coffre");
        const key = await resolveAccountKey(password, true);
        apply(await client.bindToAccount(stored, secret, key.vaultKey, key.kdf));
        keep(key);
        setStatus("unlocked");
        await reload();
      },
      changePassword: async (currentPassword, next) => {
        // Matériel à jour (un autre onglet a pu modifier le coffre).
        const latest = await client.fetch();
        const result = await accounts.setPassword({
          current: currentPassword,
          next,
          vault: latest
            ? {
                material: {
                  version: latest.version,
                  kdf: latest.kdf,
                  passphraseWrappedKey: latest.passphraseWrappedKey,
                  recoveryWrappedKey: latest.recoveryWrappedKey,
                },
                revision: latest.revision,
              }
            : null,
        });
        keep(result.key);
        const open = vaultRef.current;
        if (open && result.vault) {
          apply({ ...open, material: result.vault.material, revision: result.vault.revision });
        }
        await reload();
      },
      unlock: async (passphrase) => {
        if (!stored) throw new Error("Aucun coffre");
        apply(await client.unlock(stored, passphrase));
        setStatus("unlocked");
      },
      recover: async (recoveryKey, newPassphrase) => {
        if (!stored) throw new Error("Aucun coffre");
        apply(await client.recover(stored, recoveryKey, newPassphrase));
        setStatus("unlocked");
        await reload();
      },
      lock,
      saveIdentity: async (identity) => {
        await withConflictReload(() => client.saveIdentity(current(), identity));
        await reload();
      },
      changePassphrase: async (currentPassphrase, next) => {
        await withConflictReload(() => client.changePassphrase(current(), currentPassphrase, next));
        await reload();
      },
      uploadCv: async (file) => {
        apply(await client.uploadCv(current(), file));
      },
      downloadCv: () => client.downloadCv(current()),
      deleteCv: async () => {
        apply(await client.deleteCv(current()));
      },
      destroy: async () => {
        await client.destroy();
        apply(null);
        setStored(null);
        storedRef.current = null;
        setStatus("none");
      },
    }),
    [
      status,
      account,
      accountKey,
      vault,
      stored,
      idleMinutes,
      reload,
      client,
      accounts,
      apply,
      keep,
      lock,
      current,
      withConflictReload,
      resolveAccountKey,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const value = useContext(VaultContext);
  if (!value) throw new Error("useVault() hors de <VaultProvider>");
  return value;
}
