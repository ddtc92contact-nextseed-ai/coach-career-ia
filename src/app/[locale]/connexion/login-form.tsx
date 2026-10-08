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
        <label htmlFor="magic-email" className="text-ink-muted block text-sm font-medium">
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
          className="focus:border-brand border-line-strong bg-surface placeholder:text-ink-subtle mt-1 block w-full rounded-lg border px-3 py-2.5 text-base shadow-xs focus:outline-none"
        />
        {state.error ? (
          <p id="email-erreur" role="alert" className="text-danger-ink mt-2 text-sm">
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="border-line-strong bg-surface hover:bg-muted w-full rounded-lg border px-4 py-2.5 font-medium disabled:opacity-60"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
