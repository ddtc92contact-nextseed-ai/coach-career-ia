"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { buttonClass } from "@/components/button";
import { inputClassLg } from "@/components/form";
import { requestMagicLink, type LoginState } from "./actions";

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations("auth.login");
  const [state, action, pending] = useActionState<LoginState, FormData>(requestMagicLink, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      <div>
        <label htmlFor="magic-email" className="text-ink block text-base font-medium">
          {t("emailLabel")}
        </label>
        <input
          id="magic-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.email}
          placeholder={t("emailPlaceholder")}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "email-erreur" : undefined}
          className={inputClassLg}
        />
        {state.error ? (
          <p id="email-erreur" role="alert" className="text-danger-ink mt-2 text-base">
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass("secondary", "lg")} w-full`}
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
