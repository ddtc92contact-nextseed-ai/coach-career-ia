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
import {
  createVaultClient,
  VaultConflictError,
  VaultHttpError,
  type UnlockedVault,
} from "@/lib/vault/client";
import type { VaultFile } from "@/lib/vault/crypto";
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
 */

export type VaultStatus = "loading" | "error" | "none" | "locked" | "unlocked";

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
  /** Identité déchiffrée, `null` tant que le coffre est verrouillé. */
  identity: IdentityData | null;
  hasCv: boolean;
  idleMinutes: number;
  setIdleMinutes: (minutes: number) => void;
  reload: () => Promise<void>;
  /** Crée le coffre et renvoie la clé de secours (à montrer une seule fois). */
  setup: (passphrase: string) => Promise<string>;
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
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [stored, setStored] = useState<VaultResponse | null>(null);
  const [vault, setVault] = useState<UnlockedVault | null>(null);
  const [idleMinutes, setIdleState] = useState(defaultIdleMinutes);
  const vaultRef = useRef<UnlockedVault | null>(null);

  const apply = useCallback((next: UnlockedVault | null) => {
    vaultRef.current = next;
    setVault(next);
  }, []);

  const lock = useCallback(() => {
    apply(null);
    setStatus((current) => (current === "unlocked" ? "locked" : current));
  }, [apply]);

  const reload = useCallback(async () => {
    try {
      const next = await client.fetch();
      setStored(next);
      if (!next) {
        apply(null);
        setStatus("none");
      } else if (!vaultRef.current) {
        setStatus("locked");
      }
    } catch {
      setStatus("error");
    }
  }, [client, apply]);

  useEffect(() => {
    // Préférence locale lue après l'hydratation (absente du rendu serveur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIdleState((current) => readIdlePreference() ?? current);
    void reload();
  }, [reload]);

  // Verrouillage automatique après inactivité (y compris onglet en arrière-plan).
  useEffect(() => {
    if (!vault) return;
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
  }, [vault, idleMinutes, lock]);

  // Clé effacée de la mémoire dès que l'espace candidat est quitté.
  useEffect(() => () => apply(null), [apply]);

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
      setup: async (passphrase) => {
        const { vault: created, recoveryKey } = await client.setup(passphrase);
        apply(created);
        setStatus("unlocked");
        void client.fetch().then(setStored, () => undefined);
        return recoveryKey;
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
        setStatus("none");
      },
    }),
    [status, vault, stored, idleMinutes, reload, client, apply, lock, current, withConflictReload],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const value = useContext(VaultContext);
  if (!value) throw new Error("useVault() hors de <VaultProvider>");
  return value;
}
