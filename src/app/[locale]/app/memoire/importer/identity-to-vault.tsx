"use client";

import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { useVault } from "@/components/vault/vault-provider";
import { Link } from "@/i18n/navigation";
import type { IdentityPayload } from "@/lib/import/shared";
import { VaultConflictError } from "@/lib/vault/client";
import { emptyIdentity, mergeImportedIdentity, type IdentityData } from "@/lib/vault/identity";
import { RecoveryKeyStep, VaultAccess } from "../../identite/identity-vault";

/**
 * Proposition d'enregistrer l'identité repérée par l'import dans le coffre
 * chiffré, en un clic : le coffre est ouvert (ou créé) sur place si besoin,
 * puis l'identité y est fusionnée et chiffrée dans le navigateur
 * (`saveIdentity`) : le serveur ne reçoit que du chiffré. Sans enregistrement,
 * ces données sont oubliées en quittant la page.
 */
export function IdentityToVault({
  identity,
  experienceIds,
  saved,
  onSaved,
}: {
  identity: IdentityPayload;
  /** `ref` d'expérience du brouillon → identifiant créé (après l'enregistrement de la mémoire). */
  experienceIds?: Record<string, string>;
  saved: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("import.review.identity");
  const vault = useVault();
  const [requested, setRequested] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const running = useRef(false);

  async function save() {
    if (running.current) return;
    running.current = true;
    setFailed(false);
    setPending(true);
    const write = (base: IdentityData | null) =>
      vault.saveIdentity(
        mergeImportedIdentity(base ?? emptyIdentity(), identity, experienceIds ?? {}),
      );
    try {
      try {
        await write(vault.identity);
      } catch (error) {
        // Coffre modifié ailleurs : on refusionne sur la version à jour.
        if (!(error instanceof VaultConflictError) || !error.latest) throw error;
        await write(error.latest);
      }
      setRequested(false);
      onSaved();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
      running.current = false;
    }
  }

  // Coffre ouvert (ou créé) à la demande : l'enregistrement suit sans second clic.
  const unlocked = vault.status === "unlocked";
  const saveNow = useEffectEvent(() => void save());
  useEffect(() => {
    // Synchronisation avec le coffre (système externe) : il vient de s'ouvrir.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (requested && unlocked && !saved) saveNow();
  }, [requested, unlocked, saved]);

  return (
    <div className="border-line mt-4 space-y-4 border-t pt-4">
      {recoveryKey ? (
        <RecoveryKeyStep
          recoveryKey={recoveryKey}
          onDone={() => setRecoveryKey(null)}
          doneLabel={t("vaultContinue")}
        />
      ) : null}

      {saved ? (
        <p
          role="status"
          className="bg-brand-soft text-brand-ink flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 text-sm font-medium"
        >
          <span className="inline-flex items-center gap-2">
            <Icon name="lock" className="size-4 shrink-0" />
            {t("vaultSaved")}
          </span>
          <Link href="/app/identite" className="underline underline-offset-4">
            {t("vaultOpen")}
          </Link>
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="text-ink">{t("vault")}</p>
              <p className="text-ink-muted mt-1">{t("vaultMergeHint")}</p>
            </div>
            <button
              type="button"
              disabled={pending || vault.status === "loading"}
              onClick={() => (unlocked ? void save() : setRequested(true))}
              className={`${buttonClass("approve")} shrink-0`}
            >
              <Icon name="lock" className="size-4" />
              {pending ? t("vaultSaving") : t("vaultSave")}
            </button>
          </div>
          {failed ? (
            <p
              role="alert"
              className="border-danger-line bg-danger-soft text-danger-ink rounded-lg border px-4 py-3 text-sm"
            >
              {t("vaultError")}
            </p>
          ) : null}
          {requested && !unlocked ? (
            <div className="space-y-4">
              <p className="text-ink-muted text-sm">{t("vaultUnlock")}</p>
              <VaultAccess onCreated={setRecoveryKey} />
              <button
                type="button"
                onClick={() => setRequested(false)}
                className="text-ink-muted text-sm font-medium underline underline-offset-4"
              >
                {t("vaultCancel")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
