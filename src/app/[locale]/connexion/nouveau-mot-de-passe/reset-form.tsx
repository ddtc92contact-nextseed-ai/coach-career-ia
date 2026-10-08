"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { buttonClass } from "@/components/button";
import { PasswordField } from "@/components/password-field";
import { useRouter } from "@/i18n/navigation";
import { accountErrorKey, createAccountClient } from "@/lib/auth/account-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-strength";

type ErrorKey = "invalidToken" | "rateLimited" | "network" | "generic";

/** Nouveau mot de passe (dérivé ici ; seul le hash d'authentification est envoyé). */
export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("auth.reset");
  const tField = useTranslations("auth.passwordField");
  const router = useRouter();
  const client = useMemo(() => createAccountClient(), []);
  const [password, setPassword] = useState("");
  const [tooShort, setTooShort] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ key: ErrorKey; minutes: number } | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTooShort(password.length < MIN_PASSWORD_LENGTH);
    if (password.length < MIN_PASSWORD_LENGTH) return;
    setError(null);
    setPending(true);
    try {
      await client.resetPassword(token, password);
      setPassword("");
      router.replace("/connexion?reset=1");
    } catch (e) {
      setError(accountErrorKey(e, ["invalidToken"]));
      setPending(false);
    }
  };

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink rounded-xl border px-4 py-3"
        >
          {t(`errors.${error.key}`, { minutes: error.minutes })}
        </p>
      ) : null}
      <PasswordField
        label={t("passwordLabel")}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        size="lg"
        meter
        error={tooShort ? tField("tooShort", { min: MIN_PASSWORD_LENGTH }) : undefined}
      />
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
