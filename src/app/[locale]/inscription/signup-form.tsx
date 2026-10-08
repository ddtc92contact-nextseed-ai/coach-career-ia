"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { CheckInbox } from "@/components/auth/check-inbox";
import { buttonClass } from "@/components/button";
import { inputClassLg } from "@/components/form";
import { Icon } from "@/components/icons";
import { PasswordField } from "@/components/password-field";
import { Link } from "@/i18n/navigation";
import { accountErrorKey, createAccountClient } from "@/lib/auth/account-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-strength";
import { legalPath } from "@/lib/legal/pages";

type FieldErrors = { email?: boolean; password?: boolean; terms?: boolean };
type FormError = { key: "rateLimited" | "network" | "generic"; minutes: number };

const emailSchema = z.email().max(254);
const linkClass = "underline underline-offset-2 hover:text-ink";

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
    <form method="post" noValidate onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink rounded-xl border px-4 py-3"
        >
          {t(`errors.${error.key}`, { minutes: error.minutes })}
        </p>
      ) : null}
      <div>
        <label htmlFor={emailId} className="text-ink block text-base font-medium">
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
          className={inputClassLg}
        />
        {fields.email ? (
          <p id={`${emailId}-error`} role="alert" className="text-danger-ink mt-1.5 text-base">
            {t("errors.invalidEmail")}
          </p>
        ) : null}
      </div>
      <PasswordField
        label={t("passwordLabel")}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        size="lg"
        meter
        error={fields.password ? tField("tooShort", { min: MIN_PASSWORD_LENGTH }) : undefined}
      />
      <p className="border-line bg-subtle text-ink-muted flex gap-3 rounded-xl border px-4 py-3 text-sm">
        <Icon name="lock" className="text-brand-ink mt-0.5 size-4.5 shrink-0" />
        <span>{t("vaultNote")}</span>
      </p>
      <div>
        <div className="flex items-start gap-2">
          <input
            id={termsId}
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            aria-invalid={fields.terms ? true : undefined}
            aria-describedby={fields.terms ? `${termsId}-error` : undefined}
            className="accent-brand mt-0.5 size-5 shrink-0"
          />
          <label htmlFor={termsId} className="text-ink-muted text-base">
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
          <p id={`${termsId}-error`} role="alert" className="text-danger-ink mt-1.5 text-base">
            {t("errors.terms")}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
