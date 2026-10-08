"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { PasswordField } from "@/components/password-field";
import { useVault } from "@/components/vault/vault-provider";
import { useRouter } from "@/i18n/navigation";
import { accountErrorKey } from "@/lib/auth/account-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-strength";

type ErrorKey = "invalidCurrent" | "vaultConflict" | "rateLimited" | "network" | "generic";

/**
 * Définir (compte à lien magique) ou changer le mot de passe. Tout se passe
 * dans le navigateur : dérivation, ré-enveloppement de la clé du coffre ; le
 * serveur ne reçoit que des hashs d'authentification et l'enveloppe.
 */
export function PasswordForm({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const t = useTranslations("settings.password");
  const tLogin = useTranslations("auth.passwordLogin");
  const tField = useTranslations("auth.passwordField");
  const router = useRouter();
  const { changePassword } = useVault();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [tooShort, setTooShort] = useState(false);
  const [missingCurrent, setMissingCurrent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ key: ErrorKey; minutes: number } | null>(null);
  const [done, setDone] = useState<"set" | "change" | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setDone(null);
    setError(null);
    setMissingCurrent(hasPassword && !current);
    setTooShort(next.length < MIN_PASSWORD_LENGTH);
    if ((hasPassword && !current) || next.length < MIN_PASSWORD_LENGTH) return;
    setPending(true);
    try {
      await changePassword(hasPassword ? current : null, next);
      setCurrent("");
      setNext("");
      setDone(hasPassword ? "change" : "set");
      router.refresh();
    } catch (e) {
      setError(accountErrorKey(e, ["invalidCurrent", "vaultConflict"]));
    } finally {
      setPending(false);
    }
  };

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {t(`errors.${error.key}`, { minutes: error.minutes })}
        </p>
      ) : null}
      {/* Pour que les gestionnaires de mots de passe rattachent le mot de passe au bon compte. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      {hasPassword ? (
        <PasswordField
          label={t("current")}
          name="current-password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          error={missingCurrent ? tLogin("errors.passwordRequired") : undefined}
        />
      ) : null}
      <PasswordField
        label={t("next")}
        name="new-password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        meter
        error={tooShort ? tField("tooShort", { min: MIN_PASSWORD_LENGTH }) : undefined}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-stone-900 px-5 py-2.5 font-medium text-white hover:bg-stone-700 disabled:opacity-60 sm:w-auto"
        >
          {pending ? t("working") : hasPassword ? t("submitChange") : t("submitSet")}
        </button>
        {done ? (
          <p role="status" className="text-brand-700 text-sm font-medium">
            {done === "set" ? t("doneSet") : t("doneChange")}
          </p>
        ) : null}
      </div>
    </form>
  );
}
