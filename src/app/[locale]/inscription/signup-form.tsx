"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { CheckInbox } from "@/components/auth/check-inbox";
import { inputClass } from "@/components/form";
import { PasswordField } from "@/components/password-field";
import { Link } from "@/i18n/navigation";
import { accountErrorKey, createAccountClient } from "@/lib/auth/account-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-strength";
import { legalPath } from "@/lib/legal/pages";

type FieldErrors = { email?: boolean; password?: boolean; terms?: boolean };
type FormError = { key: "rateLimited" | "network" | "generic"; minutes: number };

const emailSchema = z.email().max(254);
const linkClass = "underline underline-offset-2 hover:text-stone-900";

/**
 * Inscription : e-mail + mot de passe (dérivé ici, jamais envoyé) +
 * acceptation des conditions. Le compte est créé non vérifié : l'écran
 * « vérifiez votre boîte mail » prend ensuite le relais.
 */
export function SignupForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations("auth.signup");
  const tField = useTranslations("auth.passwordField");
  const locale = useLocale();
  const client = useMemo(() => createAccountClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<FormError | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailId = useId();
  const termsId = useId();

  if (sentTo) {
    return <CheckInbox email={sentTo} reason="signup" onBack={() => setSentTo(null)} />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    const next: FieldErrors = {
      email: !emailSchema.safeParse(address).success || undefined,
      password: password.length < MIN_PASSWORD_LENGTH || undefined,
      terms: !terms || undefined,
    };
    setFields(next);
    setError(null);
    if (next.email || next.password || next.terms) return;
    setPending(true);
    try {
      await client.signup(address, password, locale, callbackUrl);
      setPassword("");
      setSentTo(address);
    } catch (e) {
      const { key, minutes } = accountErrorKey(e, []);
      setError({ key, minutes });
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
      <div>
        <label htmlFor={emailId} className="block text-sm font-medium text-stone-800">
          {t("emailLabel")}
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
          aria-invalid={fields.email ? true : undefined}
          aria-describedby={fields.email ? `${emailId}-error` : undefined}
          className={inputClass}
        />
        {fields.email ? (
          <p id={`${emailId}-error`} role="alert" className="mt-1.5 text-sm text-red-700">
            {t("errors.invalidEmail")}
          </p>
        ) : null}
      </div>
      <PasswordField
        label={t("passwordLabel")}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        meter
        error={fields.password ? tField("tooShort", { min: MIN_PASSWORD_LENGTH }) : undefined}
      />
      <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">{t("vaultNote")}</p>
      <div>
        <div className="flex items-start gap-2">
          <input
            id={termsId}
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            aria-invalid={fields.terms ? true : undefined}
            aria-describedby={fields.terms ? `${termsId}-error` : undefined}
            className="mt-1 size-4 shrink-0"
          />
          <label htmlFor={termsId} className="text-sm text-stone-700">
            {t.rich("acceptTerms", {
              terms: (chunks) => (
                <Link href={legalPath("terms")} className={linkClass} target="_blank">
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link href={legalPath("privacy")} className={linkClass} target="_blank">
                  {chunks}
                </Link>
              ),
            })}
          </label>
        </div>
        {fields.terms ? (
          <p id={`${termsId}-error`} role="alert" className="mt-1.5 text-sm text-red-700">
            {t("errors.terms")}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-stone-900 px-4 py-2.5 font-medium text-white hover:bg-stone-700 disabled:opacity-60"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
