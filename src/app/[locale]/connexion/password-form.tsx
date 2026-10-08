"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { CheckInbox } from "@/components/auth/check-inbox";
import { buttonClass } from "@/components/button";
import { inputClassLg } from "@/components/form";
import { PasswordField } from "@/components/password-field";
import { Link, useRouter } from "@/i18n/navigation";
import { accountErrorKey, createAccountClient } from "@/lib/auth/account-client";
import { handOffAccountKey } from "@/lib/auth/key-handoff";

type ErrorKey =
  | "invalidEmail"
  | "passwordRequired"
  | "invalidCredentials"
  | "rateLimited"
  | "network"
  | "generic";

const emailSchema = z.email().max(254);

/**
 * Connexion par e-mail + mot de passe. Le formulaire n'est jamais soumis au
 * serveur : le mot de passe est dérivé ici (`deriveAccountKeys`), seul le hash
 * d'authentification part. La clé du coffre qui en découle est transmise en
 * mémoire à l'espace candidat, qui s'ouvre donc déverrouillé.
 */
export function PasswordLoginForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations("auth.passwordLogin");
  const tLogin = useTranslations("auth.login");
  const router = useRouter();
  const client = useMemo(() => createAccountClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ key: ErrorKey; minutes: number } | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const emailId = useId();
  const rememberId = useId();

  if (unverified) {
    return <CheckInbox email={unverified} reason="unverified" onBack={() => setUnverified(null)} />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!emailSchema.safeParse(address).success) {
      return setError({ key: "invalidEmail", minutes: 0 });
    }
    if (!password) return setError({ key: "passwordRequired", minutes: 0 });
    setError(null);
    setPending(true);
    try {
      const key = await client.login(address, password, remember);
      handOffAccountKey(key);
      setPassword("");
      router.replace(callbackUrl);
      router.refresh();
    } catch (e) {
      const described = accountErrorKey(e, ["invalidCredentials", "unverified"]);
      if (described.key === "unverified") {
        setUnverified(address);
      } else {
        setError({ key: described.key, minutes: described.minutes });
      }
      setPending(false);
    }
  };

  const emailError = error?.key === "invalidEmail";
  return (
    <form method="post" noValidate onSubmit={onSubmit} className="space-y-5">
      {error && !emailError && error.key !== "passwordRequired" ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink rounded-xl border px-4 py-3"
        >
          {t(`errors.${error.key}`, { minutes: error.minutes })}
        </p>
      ) : null}
      <div>
        <label htmlFor={emailId} className="text-ink block text-base font-medium">
          {tLogin("emailLabel")}
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={tLogin("emailPlaceholder")}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? `${emailId}-error` : undefined}
          className={inputClassLg}
        />
        {emailError ? (
          <p id={`${emailId}-error`} role="alert" className="text-danger-ink mt-1.5 text-base">
            {t("errors.invalidEmail")}
          </p>
        ) : null}
      </div>
      <PasswordField
        label={t("passwordLabel")}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        size="lg"
        error={error?.key === "passwordRequired" ? t("errors.passwordRequired") : undefined}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <input
            id={rememberId}
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="accent-brand size-5 shrink-0"
          />
          <label htmlFor={rememberId} className="text-ink-muted text-base">
            {t("remember")}
          </label>
        </div>
        <Link
          href="/connexion/mot-de-passe-oublie"
          className="text-ink-muted hover:text-ink text-base font-medium underline underline-offset-4"
        >
          {t("forgot")}
        </Link>
      </div>
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
