"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { inputClass } from "@/components/form";
import { RevealedIdentityView } from "@/components/revealed-identity";
import { useVault } from "@/components/vault/vault-provider";
import { LockIcon } from "@/components/vault/vault-widgets";
import { Link } from "@/i18n/navigation";
import {
  buildReveal,
  emptySelection,
  isAllowedCv,
  previewIdentity,
  revealedFields,
  type HandoverSelection,
} from "@/lib/handover/schema";
import { CopyText } from "./draft-panel";

/**
 * Levée d'anonymat pour CE fil : déverrouillage du coffre dans le navigateur,
 * choix des champs, aperçu de ce que verra l'entreprise, confirmation.
 *
 * Rien ne quitte le navigateur avant la confirmation ; à ce moment, une seule
 * requête part, avec les seuls champs cochés (et le CV, s'il est coché, déchiffré
 * localement). Aucun champ n'est coché par défaut.
 */

const primary =
  "w-full rounded-lg bg-primary px-5 py-2.5 font-medium text-on-primary hover:bg-primary-hover disabled:opacity-60 sm:w-auto";
const revealClass =
  "bg-brand hover:bg-brand-hover w-full rounded-lg px-5 py-2.5 font-medium text-on-brand disabled:opacity-60 sm:w-auto";
const secondary =
  "w-full rounded-lg border border-line-strong px-5 py-2.5 font-medium hover:bg-muted disabled:opacity-60 sm:w-auto";

type Step = "closed" | "select" | "preview" | "done";
type ErrorCode =
  | "notSent"
  | "noReply"
  | "alreadyRevealed"
  | "closed"
  | "invalid"
  | "cvInvalid"
  | "sendUnavailable"
  | "sendFailed"
  | "notFound"
  | "network"
  | "wrongPassphrase"
  | "nothingSelected";

const KNOWN_ERRORS = new Set<string>([
  "notSent",
  "noReply",
  "alreadyRevealed",
  "closed",
  "invalid",
  "cvInvalid",
  "sendUnavailable",
  "sendFailed",
  "notFound",
]);

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0"
      />
      <label htmlFor={id} className="text-ink text-sm [overflow-wrap:anywhere] break-words">
        {children}
      </label>
    </div>
  );
}

const toggle = (list: number[], index: number, on: boolean) =>
  on ? [...new Set([...list, index])] : list.filter((i) => i !== index);

export function HandoverPanel({
  contactId,
  active,
  channel,
  companyName,
  roles,
}: {
  contactId: string;
  /** Une levée est déjà active sur ce fil (affichée par la page). */
  active: boolean;
  channel: "EMAIL" | "APPLY_URL" | "PORTAL";
  companyName: string | null;
  /** Intitulés des postes de la mémoire (pseudonymisée), par expérience. */
  roles: Record<string, string>;
}) {
  const t = useTranslations("handover");
  const router = useRouter();
  const vault = useVault();
  const [step, setStep] = useState<Step>("closed");
  const [selection, setSelection] = useState<HandoverSelection>(emptySelection);
  const [cvMeta, setCvMeta] = useState<{ name: string; type: string; size: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, setPending] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);

  const company = companyName ?? t("thisCompany");
  const alert = error ? (
    <p role="alert" className="text-danger-ink text-sm">
      {t(`errors.${error}`)}
    </p>
  ) : null;

  if (step === "done") {
    return (
      <div className="space-y-3">
        <p role="status" className="bg-brand-soft text-brand-ink rounded-lg px-3 py-2 text-sm">
          {doneUrl
            ? t("doneManual")
            : t(channel === "PORTAL" ? "donePortal" : "doneEmail", { company })}
        </p>
        {doneUrl ? <CopyText text={doneUrl} rows={3} /> : null}
      </div>
    );
  }

  if (active) return null;

  if (step === "closed") {
    return (
      <div className="space-y-2">
        <p className="text-ink-muted text-sm">{t("intro", { company })}</p>
        <button type="button" className={primary} onClick={() => setStep("select")}>
          {t("start")}
        </button>
      </div>
    );
  }

  const cancel = (
    <button
      type="button"
      className={secondary}
      onClick={() => {
        setStep("closed");
        setSelection(emptySelection());
        setConfirmed(false);
        setError(null);
      }}
    >
      {t("cancel")}
    </button>
  );

  // --- Coffre ---------------------------------------------------------------------
  if (vault.status === "loading") {
    return (
      <p role="status" className="text-ink-subtle text-sm">
        {t("vaultLoading")}
      </p>
    );
  }
  if (vault.status === "error") {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-danger-ink text-sm">
          {t("errors.network")}
        </p>
        <button type="button" className={secondary} onClick={() => void vault.reload()}>
          {t("retry")}
        </button>
      </div>
    );
  }
  if (vault.status === "none") {
    return (
      <div className="border-warning-line bg-warning-soft space-y-3 rounded-lg border p-3">
        <p className="text-warning-ink text-sm">{t("noVault")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/app/identite" className={`${primary} text-center`}>
            {t("createVault")}
          </Link>
          {cancel}
        </div>
      </div>
    );
  }
  if (vault.status === "locked" || !vault.identity) {
    return (
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setPending(true);
          try {
            await vault.unlock(passphrase);
            setPassphrase("");
          } catch {
            setError("wrongPassphrase");
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="text-ink-muted flex items-center gap-2 text-sm">
          <LockIcon />
          {t("unlockIntro")}
        </p>
        {alert}
        <label className="block text-sm font-medium">
          {t("passphrase")}
          <input
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="submit" disabled={pending || !passphrase} className={primary}>
            {pending ? t("unlocking") : t("unlock")}
          </button>
          {cancel}
        </div>
      </form>
    );
  }

  // --- Sélection et aperçu ---------------------------------------------------------
  const identity = vault.identity;
  const reveal = buildReveal(identity, selection);
  const fields = revealedFields(reveal, selection.cv && vault.hasCv);
  const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(" ");
  const nothingInVault =
    !fullName &&
    !identity.email &&
    !identity.phone &&
    identity.links.every((l) => !l.url) &&
    identity.employers.every((e) => !e.name) &&
    identity.schools.every((s) => !s.name) &&
    !vault.hasCv;

  if (nothingInVault) {
    return (
      <div className="border-warning-line bg-warning-soft space-y-3 rounded-lg border p-3">
        <p className="text-warning-ink text-sm">{t("emptyVault")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/app/identite" className={`${primary} text-center`}>
            {t("completeVault")}
          </Link>
          {cancel}
        </div>
      </div>
    );
  }

  if (step === "select") {
    return (
      <div className="space-y-4">
        <p className="text-ink-muted text-sm">{t("selectIntro", { company })}</p>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">{t("selectTitle")}</legend>
          {fullName ? (
            <Check
              checked={selection.name}
              onChange={(v) => setSelection((s) => ({ ...s, name: v }))}
            >
              {t("fields.name")} : <span className="font-medium">{fullName}</span>
            </Check>
          ) : null}
          {identity.email ? (
            <Check
              checked={selection.email}
              onChange={(v) => setSelection((s) => ({ ...s, email: v }))}
            >
              {t("fields.email")} : <span className="font-medium">{identity.email}</span>
            </Check>
          ) : null}
          {identity.phone ? (
            <Check
              checked={selection.phone}
              onChange={(v) => setSelection((s) => ({ ...s, phone: v }))}
            >
              {t("fields.phone")} : <span className="font-medium">{identity.phone}</span>
            </Check>
          ) : null}
          {identity.links.map((l, i) =>
            l.url ? (
              <Check
                key={`l${i}`}
                checked={selection.links.includes(i)}
                onChange={(v) => setSelection((s) => ({ ...s, links: toggle(s.links, i, v) }))}
              >
                {l.label || t("fields.link")} : <span className="font-medium">{l.url}</span>
              </Check>
            ) : null,
          )}
          {identity.employers.map((e, i) =>
            e.name ? (
              <Check
                key={`e${i}`}
                checked={selection.employers.includes(i)}
                onChange={(v) =>
                  setSelection((s) => ({ ...s, employers: toggle(s.employers, i, v) }))
                }
              >
                {t("fields.employer")} : <span className="font-medium">{e.name}</span>
                {e.experienceId && roles[e.experienceId] ? (
                  <span className="text-ink-subtle"> ({roles[e.experienceId]})</span>
                ) : null}
              </Check>
            ) : null,
          )}
          {identity.schools.map((s, i) =>
            s.name ? (
              <Check
                key={`s${i}`}
                checked={selection.schools.includes(i)}
                onChange={(v) => setSelection((x) => ({ ...x, schools: toggle(x.schools, i, v) }))}
              >
                {t("fields.school")} : <span className="font-medium">{s.name}</span>
              </Check>
            ) : null,
          )}
          {vault.hasCv ? (
            <Check checked={selection.cv} onChange={(v) => setSelection((s) => ({ ...s, cv: v }))}>
              {t("fields.cvOriginal")}
            </Check>
          ) : null}
        </fieldset>
        {alert}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className={primary}
            disabled={pending}
            onClick={async () => {
              setError(null);
              if (fields.length === 0) return setError("nothingSelected");
              if (selection.cv) {
                // Nom et type du CV lus localement pour l'aperçu.
                setPending(true);
                try {
                  const file = await vault.downloadCv();
                  if (!isAllowedCv({ size: file.bytes.length, type: file.type })) {
                    return setError("cvInvalid");
                  }
                  setCvMeta({ name: file.name, type: file.type, size: file.bytes.length });
                } catch {
                  return setError("network");
                } finally {
                  setPending(false);
                }
              } else {
                setCvMeta(null);
              }
              setConfirmed(false);
              setStep("preview");
            }}
          >
            {t("preview")}
          </button>
          {cancel}
        </div>
      </div>
    );
  }

  // step === "preview"
  const preview = previewIdentity(reveal, roles, selection.cv ? cvMeta : null);
  return (
    <div className="space-y-4">
      <h3 className="font-semibold">{t("previewTitle", { company })}</h3>
      <p className="text-ink-muted text-sm">{t("previewIntro")}</p>
      <RevealedIdentityView identity={preview} />
      <p className="text-ink-muted text-sm">
        {channel === "EMAIL"
          ? t("previewEmail")
          : channel === "PORTAL"
            ? t("previewPortal")
            : t("previewManual")}
      </p>
      <Check checked={confirmed} onChange={setConfirmed}>
        {t("confirmLabel", { company })}
      </Check>
      {alert}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          className={revealClass}
          disabled={!confirmed || pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            try {
              const form = new FormData();
              form.set("payload", JSON.stringify(reveal));
              if (selection.cv) {
                const file = await vault.downloadCv();
                form.set("cv", new File([file.bytes], file.name, { type: file.type }));
              }
              const response = await fetch(
                `/api/contacts/${encodeURIComponent(contactId)}/handover`,
                {
                  method: "POST",
                  body: form,
                  credentials: "same-origin",
                  cache: "no-store",
                },
              );
              const body = (await response.json().catch(() => ({}))) as {
                ok?: boolean;
                url?: string | null;
                error?: string;
              };
              if (!response.ok || !body.ok) {
                setError(
                  body.error && KNOWN_ERRORS.has(body.error)
                    ? (body.error as ErrorCode)
                    : "network",
                );
                return;
              }
              setDoneUrl(body.url ?? null);
              setSelection(emptySelection());
              setStep("done");
              router.refresh();
            } catch {
              setError("network");
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? t("revealing") : t("confirm")}
        </button>
        <button type="button" className={secondary} onClick={() => setStep("select")}>
          {t("back")}
        </button>
      </div>
    </div>
  );
}
