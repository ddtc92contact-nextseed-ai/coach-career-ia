"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { requestMagicLink, type LoginState } from "./actions";

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations("auth.login");
  const [state, action, pending] = useActionState<LoginState, FormData>(requestMagicLink, {});

  return (
    <form action={action} className="space-y-4" noValidate>
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-stone-700">
          {t("emailLabel")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.email}
          placeholder={t("emailPlaceholder")}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "email-erreur" : undefined}
          className="focus:border-brand-600 mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base shadow-xs placeholder:text-stone-400 focus:outline-none"
        />
        {state.error ? (
          <p id="email-erreur" role="alert" className="mt-2 text-sm text-red-700">
            {t(`errors.${state.error}`)}
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
