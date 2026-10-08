"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { inputClass } from "@/components/form";
import { PasswordField } from "@/components/password-field";
import { IDLE_CHOICES, useVault } from "@/components/vault/vault-provider";
import { LockIcon } from "@/components/vault/vault-widgets";
import { Link } from "@/i18n/navigation";
import { AccountError } from "@/lib/auth/account-client";
import { VaultConflictError, VaultHttpError } from "@/lib/vault/client";
import { MIN_PASSPHRASE_LENGTH, VaultDecryptError, VaultParamsError } from "@/lib/vault/crypto";
import {
  CV_MIME_TYPES,
  emptyIdentity,
  MAX_CV_BYTES,
  type IdentityData,
} from "@/lib/vault/identity";

type ExperienceOption = { id: string; label: string };
type ErrorKey =
  | "tooShort"
  | "mismatch"
  | "understand"
  | "wrongPassphrase"
  | "wrongRecoveryKey"
  | "wrongPassword"
  | "conflict"
  | "network"
  | "cvTooLarge"
  | "cvType"
  | "generic";

const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";
const primaryButton =
  "w-full rounded-lg bg-stone-900 px-5 py-2.5 font-medium text-white hover:bg-stone-700 disabled:opacity-60 sm:w-auto";
const secondaryButton =
  "rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium hover:bg-stone-100 disabled:opacity-60";
const dangerButton =
  "rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60";

function errorKey(error: unknown, fallback: ErrorKey = "generic"): ErrorKey {
  if (error instanceof VaultDecryptError) return fallback;
  // Mot de passe du compte refusé par le serveur avant d'envelopper le coffre.
  if (error instanceof AccountError) {
    return error.code === "invalidCurrent" ? "wrongPassword" : "generic";
  }
  if (error instanceof VaultParamsError) return "generic";
  if (error instanceof VaultHttpError) return error.status === 409 ? "conflict" : "generic";
  if (error instanceof TypeError) return "network";
  return "generic";
}

/** Formulaire du coffre : jamais soumis au serveur (tout est traité localement). */
function LocalForm({
  onSubmit,
  children,
  className = "space-y-4",
}: {
  onSubmit: () => Promise<void> | void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form
      method="post"
      noValidate
      autoComplete="off"
      className={className}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function Alert({ error }: { error: ErrorKey | null }) {
  const t = useTranslations("identity.errors");
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {t(error, { min: MIN_PASSPHRASE_LENGTH })}
    </p>
  );
}

function TextInput({
  label,
  hint,
  value,
  onChange,
  type = "text",
  autoComplete,
  maxLength,
  inputMode,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  inputMode?: "text" | "email" | "tel" | "url";
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-stone-500">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete ?? "off"}
        maxLength={maxLength}
        inputMode={inputMode}
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </div>
  );
}

// --- Explications ---------------------------------------------------------------------

function Explainer() {
  const t = useTranslations("identity.explain");
  return (
    <section className={`${sectionClass} bg-stone-50`} aria-labelledby="zero-connaissance">
      <h2 id="zero-connaissance" className="flex items-center gap-2 text-lg font-semibold">
        <LockIcon />
        {t("title")}
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-stone-700">
        <li>{t("encrypted")}</li>
        <li>{t("nobody")}</li>
        <li>{t("you")}</li>
        <li>{t("handover")}</li>
      </ul>
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong className="font-semibold">{t("lossTitle")}</strong> {t("loss")}
      </p>
    </section>
  );
}

// --- Clé de secours ------------------------------------------------------------------

function RecoveryKeyStep({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const t = useTranslations("identity.recovery");
  const format = useFormatter();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const checkboxId = useId();
  const fileText = () =>
    t("fileText", { key: recoveryKey, date: format.dateTime(new Date(), "short") });

  const download = () => {
    const url = URL.createObjectURL(new Blob([fileText()], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = t("fileName");
    link.click();
    URL.revokeObjectURL(url);
  };

  const print = () => {
    // Impression d'un document isolé : seule la clé est imprimée.
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const pre = doc.createElement("pre");
    pre.style.font = "16px/1.6 ui-monospace, monospace";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = fileText();
    doc.body.appendChild(pre);
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    window.setTimeout(() => frame.remove(), 1000);
  };

  return (
    <section
      className={`${sectionClass} border-amber-300`}
      aria-labelledby="cle-secours"
      role="region"
    >
      <h2 id="cle-secours" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-stone-700">{t("intro")}</p>
      <p className="mt-3 rounded-xl border border-stone-300 bg-stone-50 px-4 py-4 text-center font-mono text-base font-semibold tracking-wider break-words sm:text-lg">
        {recoveryKey}
      </p>
      <p className="mt-3 text-sm text-amber-900">{t("warning")}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={download} className={secondaryButton}>
          {t("download")}
        </button>
        <button type="button" onClick={print} className={secondaryButton}>
          {t("print")}
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(recoveryKey);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <div className="mt-5 flex items-start gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-1 size-4 shrink-0"
        />
        <label htmlFor={checkboxId} className="text-sm text-stone-700">
          {t("confirm")}
        </label>
      </div>
      <button type="button" disabled={!saved} onClick={onDone} className={`${primaryButton} mt-4`}>
        {t("continue")}
      </button>
    </section>
  );
}

// --- Déverrouillage et récupération ---------------------------------------------------

function UnlockForm({ onForgot }: { onForgot: () => void }) {
  const t = useTranslations("identity.unlock");
  const { unlock } = useVault();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <section className={sectionClass} aria-labelledby="deverrouiller">
      <h2 id="deverrouiller" className="flex items-center gap-2 text-lg font-semibold">
        <LockIcon />
        {t("title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-stone-600">{t("intro")}</p>
      <LocalForm
        onSubmit={async () => {
          setError(null);
          setPending(true);
          try {
            await unlock(passphrase);
            setPassphrase("");
          } catch (e) {
            setError(errorKey(e, "wrongPassphrase"));
          } finally {
            setPending(false);
          }
        }}
      >
        <Alert error={error} />
        <TextInput
          label={t("passphrase")}
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={setPassphrase}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="submit" disabled={pending || !passphrase} className={primaryButton}>
            {pending ? t("working") : t("submit")}
          </button>
          <button
            type="button"
            onClick={onForgot}
            className="text-sm font-medium text-stone-700 underline underline-offset-4"
          >
            {t("forgot")}
          </button>
        </div>
      </LocalForm>
    </section>
  );
}

function RecoverForm({ onBack }: { onBack: () => void }) {
  const t = useTranslations("identity.recover");
  const { recover } = useVault();
  const [recoveryKey, setRecoveryKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <section className={sectionClass} aria-labelledby="recuperer">
      <h2 id="recuperer" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-stone-600">{t("intro")}</p>
      <LocalForm
        onSubmit={async () => {
          if (passphrase.length < MIN_PASSPHRASE_LENGTH) return setError("tooShort");
          if (passphrase !== confirm) return setError("mismatch");
          setError(null);
          setPending(true);
          try {
            await recover(recoveryKey, passphrase);
          } catch (e) {
            setError(errorKey(e, "wrongRecoveryKey"));
          } finally {
            setPending(false);
          }
        }}
      >
        <Alert error={error} />
        <TextInput
          label={t("recoveryKey")}
          hint={t("recoveryKeyHint")}
          value={recoveryKey}
          onChange={setRecoveryKey}
          maxLength={80}
        />
        <TextInput
          label={t("newPassphrase")}
          hint={t("newPassphraseHint", { min: MIN_PASSPHRASE_LENGTH })}
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={setPassphrase}
        />
        <TextInput
          label={t("confirm")}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="submit" disabled={pending || !recoveryKey} className={primaryButton}>
            {pending ? t("working") : t("submit")}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-medium text-stone-700 underline underline-offset-4"
          >
            {t("back")}
          </button>
        </div>
      </LocalForm>
    </section>
  );
}

// --- Coffre lié au mot de passe du compte ------------------------------------------

function AccountSetupForm({ onCreated }: { onCreated: (recoveryKey: string) => void }) {
  const t = useTranslations("identity.accountSetup");
  const { setup, hasAccountKey } = useVault();
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  const checkboxId = useId();

  return (
    <section className={sectionClass} aria-labelledby="creer-coffre">
      <h2 id="creer-coffre" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-stone-600">{t("intro")}</p>
      <LocalForm
        onSubmit={async () => {
          if (!understood) return setError("understand");
          setError(null);
          setPending(true);
          try {
            const recoveryKey = await setup(hasAccountKey ? undefined : password);
            setPassword("");
            onCreated(recoveryKey);
          } catch (e) {
            setError(errorKey(e, "wrongPassword"));
          } finally {
            setPending(false);
          }
        }}
      >
        <Alert error={error} />
        {hasAccountKey ? null : (
          <PasswordField
            label={t("password")}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        )}
        <div className="flex items-start gap-2">
          <input
            id={checkboxId}
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-1 size-4 shrink-0"
          />
          <label htmlFor={checkboxId} className="text-sm text-stone-700">
            {t("understand")}
          </label>
        </div>
        <button
          type="submit"
          disabled={pending || (!hasAccountKey && !password)}
          className={primaryButton}
        >
          {pending ? t("working") : t("submit")}
        </button>
      </LocalForm>
    </section>
  );
}

function NoPasswordNotice() {
  const t = useTranslations("identity.noPassword");
  return (
    <section className={sectionClass} aria-labelledby="sans-mot-de-passe">
      <h2 id="sans-mot-de-passe" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-stone-600">{t("text")}</p>
      <Link
        href="/app/parametres#mot-de-passe"
        className={`${primaryButton} inline-block text-center`}
      >
        {t("link")}
      </Link>
    </section>
  );
}

function PasswordTip() {
  const t = useTranslations("identity");
  return (
    <p className="border-brand-100 bg-brand-50 text-brand-800 rounded-2xl border px-4 py-3 text-sm">
      {t("passwordTip")}{" "}
      <Link
        href="/app/parametres#mot-de-passe"
        className="font-medium underline underline-offset-4"
      >
        {t("passwordTipLink")}
      </Link>
    </p>
  );
}

function AccountUnlockForm() {
  const t = useTranslations("identity.accountUnlock");
  const { unlockWithPassword } = useVault();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <section className={sectionClass} aria-labelledby="deverrouiller">
      <h2 id="deverrouiller" className="flex items-center gap-2 text-lg font-semibold">
        <LockIcon />
        {t("title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-stone-600">{t("intro")}</p>
      <LocalForm
        onSubmit={async () => {
          setError(null);
          setPending(true);
          try {
            await unlockWithPassword(password);
            setPassword("");
          } catch (e) {
            setError(errorKey(e, "wrongPassword"));
          } finally {
            setPending(false);
          }
        }}
      >
        <Alert error={error} />
        <PasswordField
          label={t("password")}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="submit" disabled={pending || !password} className={primaryButton}>
            {pending ? t("working") : t("submit")}
          </button>
          <Link
            href="/connexion/mot-de-passe-oublie"
            className="text-sm font-medium text-stone-700 underline underline-offset-4"
          >
            {t("forgot")}
          </Link>
        </div>
      </LocalForm>
    </section>
  );
}

/**
 * Lie le coffre au mot de passe du compte : ancien coffre à phrase secrète
 * (`legacy`, phrase ou clé de secours) ou mot de passe réinitialisé par
 * e-mail (`stale`, clé de secours uniquement).
 */
function BindForm({ kind }: { kind: "legacy" | "stale" }) {
  const t = useTranslations(`identity.${kind}`);
  const { bindToAccount, hasAccountKey } = useVault();
  const [useRecovery, setUseRecovery] = useState(kind === "stale");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <section className={sectionClass} aria-labelledby="relier-coffre">
      <h2 id="relier-coffre" className="flex items-center gap-2 text-lg font-semibold">
        <LockIcon />
        {t("title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-stone-600">{t("intro")}</p>
      <LocalForm
        onSubmit={async () => {
          setError(null);
          setPending(true);
          try {
            await bindToAccount(
              useRecovery ? { recoveryKey: secret } : { passphrase: secret },
              hasAccountKey ? undefined : password,
            );
            setSecret("");
            setPassword("");
          } catch (e) {
            setError(errorKey(e, useRecovery ? "wrongRecoveryKey" : "wrongPassphrase"));
          } finally {
            setPending(false);
          }
        }}
      >
        <Alert error={error} />
        {useRecovery ? (
          <TextInput label={t("recoveryKey")} value={secret} onChange={setSecret} maxLength={80} />
        ) : (
          <TextInput
            label={t("passphrase")}
            type="password"
            autoComplete="off"
            value={secret}
            onChange={setSecret}
          />
        )}
        {hasAccountKey ? null : (
          <PasswordField
            label={t("password")}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            disabled={pending || !secret || (!hasAccountKey && !password)}
            className={primaryButton}
          >
            {pending ? t("working") : t("submit")}
          </button>
          {kind === "legacy" ? (
            <button
              type="button"
              onClick={() => {
                setUseRecovery((v) => !v);
                setSecret("");
                setError(null);
              }}
              className="text-sm font-medium text-stone-700 underline underline-offset-4"
            >
              {useRecovery ? t("usePassphrase") : t("useRecovery")}
            </button>
          ) : null}
        </div>
      </LocalForm>
    </section>
  );
}

function StaleNoKey() {
  const t = useTranslations("identity.stale");
  return (
    <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <strong className="font-semibold">{t("noKeyTitle")}</strong> {t("noKey")}
    </p>
  );
}

// --- Édition de l'identité -----------------------------------------------------------

function ListSection<T>({
  title,
  intro,
  items,
  onChange,
  empty,
  addLabel,
  render,
}: {
  title: string;
  intro?: string;
  items: T[];
  onChange: (items: T[]) => void;
  empty: () => T;
  addLabel: string;
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode;
}) {
  const t = useTranslations("identity.form");
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">{title}</legend>
      {intro ? <p className="-mt-1 text-sm text-stone-600">{intro}</p> : null}
      {items.length === 0 ? <p className="text-sm text-stone-500">{t("none")}</p> : null}
      <ul className="space-y-3">
        {items.map((item, index) => (
          <li key={index} className="rounded-xl border border-stone-200 p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {render(item, (patch) =>
                onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it))),
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="rounded-lg border border-stone-200 px-2.5 py-1 text-sm text-stone-700 hover:bg-stone-50"
              >
                {t("remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...items, empty()])}
        className={secondaryButton}
      >
        {addLabel}
      </button>
    </fieldset>
  );
}

function ExperienceSelect({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: ExperienceOption[];
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations("identity.form");
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {t("employerExperience")}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputClass}
      >
        <option value="">{t("noExperience")}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function IdentityEditor({ experiences }: { experiences: ExperienceOption[] }) {
  const t = useTranslations("identity.form");
  const { identity, saveIdentity } = useVault();
  const [draft, setDraft] = useState<IdentityData>(() => identity ?? emptyIdentity());
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<IdentityData>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };

  return (
    <section className={sectionClass} aria-labelledby="mon-identite">
      <h2 id="mon-identite" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 mb-5 text-sm text-stone-600">{t("intro")}</p>
      <LocalForm
        className="space-y-8"
        onSubmit={async () => {
          setError(null);
          setPending(true);
          try {
            await saveIdentity(draft);
            setSaved(true);
          } catch (e) {
            setError(errorKey(e));
            // Le coffre a été rechargé : le formulaire repart de la version à jour.
            if (e instanceof VaultConflictError && e.latest) setDraft(e.latest);
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset className="space-y-3">
          <legend className="text-base font-semibold">{t("identityTitle")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label={t("firstName")}
              value={draft.firstName}
              maxLength={100}
              onChange={(firstName) => set({ firstName })}
            />
            <TextInput
              label={t("lastName")}
              value={draft.lastName}
              maxLength={100}
              onChange={(lastName) => set({ lastName })}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-base font-semibold">{t("contactTitle")}</legend>
          <p className="-mt-1 text-sm text-stone-600">{t("contactIntro")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label={t("email")}
              type="email"
              inputMode="email"
              value={draft.email}
              maxLength={254}
              onChange={(email) => set({ email })}
            />
            <TextInput
              label={t("phone")}
              type="tel"
              inputMode="tel"
              value={draft.phone}
              maxLength={40}
              onChange={(phone) => set({ phone })}
            />
          </div>
        </fieldset>

        <ListSection
          title={t("employersTitle")}
          intro={t("employersIntro")}
          items={draft.employers}
          onChange={(employers) => set({ employers })}
          empty={() => ({ name: "", experienceId: null })}
          addLabel={t("addEmployer")}
          render={(item, update) => (
            <>
              <TextInput
                label={t("employerName")}
                value={item.name}
                maxLength={160}
                onChange={(name) => update({ name })}
              />
              <ExperienceSelect
                value={item.experienceId}
                options={experiences}
                onChange={(experienceId) => update({ experienceId })}
              />
            </>
          )}
        />

        <ListSection
          title={t("schoolsTitle")}
          items={draft.schools}
          onChange={(schools) => set({ schools })}
          empty={() => ({ name: "" })}
          addLabel={t("addSchool")}
          render={(item, update) => (
            <TextInput
              label={t("schoolName")}
              value={item.name}
              maxLength={160}
              onChange={(name) => update({ name })}
            />
          )}
        />

        <ListSection
          title={t("linksTitle")}
          intro={t("linksIntro")}
          items={draft.links}
          onChange={(links) => set({ links })}
          empty={() => ({ label: "", url: "" })}
          addLabel={t("addLink")}
          render={(item, update) => (
            <>
              <TextInput
                label={t("linkLabel")}
                value={item.label}
                maxLength={80}
                onChange={(label) => update({ label })}
              />
              <TextInput
                label={t("linkUrl")}
                type="url"
                inputMode="url"
                value={item.url}
                maxLength={500}
                onChange={(url) => update({ url })}
              />
            </>
          )}
        />

        <div className="space-y-3 border-t border-stone-200 pt-5">
          <Alert error={error} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? t("saving") : t("save")}
            </button>
            {saved ? (
              <p role="status" className="text-brand-700 text-sm font-medium">
                {t("saved")}
              </p>
            ) : null}
          </div>
          <p className="text-xs text-stone-500">{t("saveHint")}</p>
        </div>
      </LocalForm>
    </section>
  );
}

// --- CV d'origine ---------------------------------------------------------------------

function CvSection() {
  const t = useTranslations("identity.cv");
  const format = useFormatter();
  const { hasCv, uploadCv, downloadCv, deleteCv } = useVault();
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState<"upload" | "download" | "delete" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const run = async (kind: NonNullable<typeof pending>, task: () => Promise<void>) => {
    setError(null);
    setPending(kind);
    try {
      await task();
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setPending(null);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CV_BYTES) return setError("cvTooLarge");
    if (!(CV_MIME_TYPES as readonly string[]).includes(file.type)) return setError("cvType");
    void run("upload", async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await uploadCv({ name: file.name, type: file.type, bytes });
      if (input.current) input.current.value = "";
    });
  };

  return (
    <section className={sectionClass} aria-labelledby="cv-origine">
      <h2 id="cv-origine" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-stone-600">{t("intro")}</p>
      <div className="space-y-3">
        <Alert error={error} />
        <p className="text-sm font-medium text-stone-800">{hasCv ? t("current") : t("none")}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {hasCv ? (
            <button
              type="button"
              disabled={pending !== null}
              className={secondaryButton}
              onClick={() =>
                run("download", async () => {
                  const file = await downloadCv();
                  const url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = file.name;
                  link.click();
                  URL.revokeObjectURL(url);
                })
              }
            >
              {pending === "download" ? t("working") : t("download")}
            </button>
          ) : null}
          {/* Champ avant son libellé : le libellé-bouton montre le focus clavier (peer). */}
          <input
            ref={input}
            id={inputId}
            type="file"
            accept={CV_MIME_TYPES.join(",")}
            className="peer sr-only"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <label
            htmlFor={inputId}
            className={`${secondaryButton} peer-focus-visible:outline-brand-600 cursor-pointer text-center peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 ${pending ? "pointer-events-none opacity-60" : ""}`}
          >
            {pending === "upload" ? t("uploading") : hasCv ? t("replace") : t("choose")}
          </label>
          {hasCv ? (
            <button
              type="button"
              disabled={pending !== null}
              className={dangerButton}
              onClick={() => {
                if (window.confirm(t("confirmDelete"))) void run("delete", deleteCv);
              }}
            >
              {pending === "delete" ? t("working") : t("delete")}
            </button>
          ) : null}
        </div>
        <p className="text-xs text-stone-500">
          {t("hint", { max: format.number(MAX_CV_BYTES / 1024 / 1024) })}
        </p>
      </div>
    </section>
  );
}

// --- Réglages : phrase secrète, verrouillage, réinitialisation -------------------------

function ChangePassphraseForm() {
  const t = useTranslations("identity.change");
  const { changePassphrase } = useVault();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <section className={sectionClass} aria-labelledby="changer-phrase">
      <h2 id="changer-phrase" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-stone-600">{t("intro")}</p>
      <LocalForm
        onSubmit={async () => {
          setDone(false);
          if (next.length < MIN_PASSPHRASE_LENGTH) return setError("tooShort");
          if (next !== confirm) return setError("mismatch");
          setError(null);
          setPending(true);
          try {
            await changePassphrase(current, next);
            setCurrent("");
            setNext("");
            setConfirm("");
            setDone(true);
          } catch (e) {
            setError(errorKey(e, "wrongPassphrase"));
          } finally {
            setPending(false);
          }
        }}
      >
        <Alert error={error} />
        <TextInput
          label={t("current")}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label={t("next")}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
          />
          <TextInput
            label={t("confirm")}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="submit" disabled={pending || !current} className={primaryButton}>
            {pending ? t("working") : t("submit")}
          </button>
          {done ? (
            <p role="status" className="text-brand-700 text-sm font-medium">
              {t("done")}
            </p>
          ) : null}
        </div>
      </LocalForm>
    </section>
  );
}

function LockBar() {
  const t = useTranslations("identity");
  const { lock, idleMinutes, setIdleMinutes } = useVault();
  const id = useId();
  const choices = (IDLE_CHOICES as readonly number[]).includes(idleMinutes)
    ? IDLE_CHOICES
    : [...IDLE_CHOICES, idleMinutes].sort((a, b) => a - b);
  return (
    <div className="border-brand-100 bg-brand-50 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-brand-800 flex items-center gap-2 text-sm font-medium" role="status">
        <LockIcon open />
        {t("unlocked.status")}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor={id} className="text-sm text-stone-700">
          {t("unlocked.idle")}
        </label>
        <select
          id={id}
          value={idleMinutes}
          onChange={(e) => setIdleMinutes(Number(e.target.value))}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm"
        >
          {choices.map((minutes) => (
            <option key={minutes} value={minutes}>
              {t("unlocked.idleOption", { minutes })}
            </option>
          ))}
        </select>
        <button type="button" onClick={lock} className={`${primaryButton} sm:ml-2`}>
          {t("lock")}
        </button>
      </div>
    </div>
  );
}

function ResetSection() {
  const t = useTranslations("identity.reset");
  const { destroy } = useVault();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  return (
    <section className={`${sectionClass} border-red-200`} aria-labelledby="reinitialiser">
      <h2 id="reinitialiser" className="text-lg font-semibold text-red-800">
        {t("title")}
      </h2>
      <p className="mt-1 mb-4 text-sm text-stone-600">{t("intro")}</p>
      <Alert error={error} />
      <button
        type="button"
        disabled={pending}
        className={dangerButton}
        onClick={async () => {
          if (!window.confirm(t("confirm"))) return;
          setPending(true);
          setError(null);
          try {
            await destroy();
          } catch (e) {
            setError(errorKey(e));
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? t("working") : t("button")}
      </button>
    </section>
  );
}

// --- Page -------------------------------------------------------------------------------

export function IdentityVaultPanel({ experiences }: { experiences: ExperienceOption[] }) {
  const t = useTranslations("identity");
  const { status, reload, hasPassword } = useVault();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  let body: ReactNode;
  if (recoveryKey) {
    body = <RecoveryKeyStep recoveryKey={recoveryKey} onDone={() => setRecoveryKey(null)} />;
  } else if (status === "loading") {
    body = (
      <p role="status" className="text-sm text-stone-500">
        {t("loading")}
      </p>
    );
  } else if (status === "error") {
    body = (
      <div className="space-y-3">
        <Alert error="network" />
        <button type="button" onClick={() => void reload()} className={secondaryButton}>
          {t("retry")}
        </button>
      </div>
    );
  } else if (status === "none") {
    body = hasPassword ? <AccountSetupForm onCreated={setRecoveryKey} /> : <NoPasswordNotice />;
  } else if (status === "locked" && hasPassword) {
    body = (
      <>
        <AccountUnlockForm />
        <ResetSection />
      </>
    );
  } else if (status === "legacy") {
    body = (
      <>
        <BindForm kind="legacy" />
        <ResetSection />
      </>
    );
  } else if (status === "stale") {
    body = (
      <>
        <BindForm kind="stale" />
        <StaleNoKey />
        <ResetSection />
      </>
    );
  } else if (status === "locked") {
    // Compte sans mot de passe (lien magique) : ancienne phrase secrète du coffre.
    body = (
      <>
        <PasswordTip />
        {recovering ? (
          <RecoverForm onBack={() => setRecovering(false)} />
        ) : (
          <UnlockForm onForgot={() => setRecovering(true)} />
        )}
        <ResetSection />
      </>
    );
  } else {
    body = (
      <>
        <LockBar />
        <IdentityEditor experiences={experiences} />
        <CvSection />
        {hasPassword ? null : <ChangePassphraseForm />}
        <ResetSection />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <Explainer />
      {body}
    </div>
  );
}
