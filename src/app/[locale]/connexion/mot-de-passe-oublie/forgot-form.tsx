"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { buttonClass } from "@/components/button";
import { inputClassLg } from "@/components/form";
import { accountErrorKey, createAccountClient } from "@/lib/auth/account-client";

type ErrorKey = "invalidEmail" | "rateLimited" | "network" | "generic";

/** Demande de lien de réinitialisation : réponse identique que le compte existe ou non. */
export function ForgotForm() {
  const t = useTranslations("auth.forgot");
  const locale = useLocale();
  const client = useMemo(() => createAccountClient(), []);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<{ key: ErrorKey; minutes: number } | null>(null);
  const id = useId();

  if (sent) {
    return (
      <p
        role="status"
        className="border-brand-line bg-brand-soft text-brand-ink rounded-xl border px-4 py-3"
      >
        {t("sent")}
      </p>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!z.email().max(254).safeParse(address).success) {
      return setError({ key: "invalidEmail", minutes: 0 });
    }
    setError(null);
    setPending(true);
    try {
      await client.requestReset(address, locale);
      setSent(true);
    } catch (e) {
      setError(accountErrorKey(e, []));
    } finally {
      setPending(false);
    }
  };

  return (
    <form method="post" noValidate onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor={id} className="text-ink block text-base font-medium">
          {t("emailLabel")}
        </label>
        <input
          id={id}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error?.key === "invalidEmail" ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={inputClassLg}
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-danger-ink mt-1.5 text-base">
            {t(`errors.${error.key}`, { minutes: error.minutes })}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
