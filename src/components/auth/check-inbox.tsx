"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { accountErrorKey, createAccountClient } from "@/lib/auth/account-client";

/**
 * « Vérifiez votre boîte mail » après l'inscription, ou à la connexion d'un
 * compte non vérifié, avec renvoi du lien de vérification.
 */
export function CheckInbox({
  email,
  reason,
  onBack,
}: {
  email: string;
  reason: "signup" | "unverified";
  onBack: () => void;
}) {
  const t = useTranslations("auth.checkInbox");
  const locale = useLocale();
  const client = useMemo(() => createAccountClient(), []);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<{ key: "rateLimited" | "generic"; minutes: number } | null>(
    null,
  );

  return (
    <div role="status" className="space-y-4">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="text-ink-muted text-sm break-words">
        {reason === "signup" ? t("text", { email }) : t("unverified", { email })}
      </p>
      <p className="text-ink-subtle text-sm">{t("help")}</p>
      {state === "sent" ? (
        <p className="text-brand-ink text-sm font-medium">{t("resent")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger-ink text-sm">
          {t(`errors.${error.key}`, { minutes: error.minutes })}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          disabled={state === "sending"}
          onClick={async () => {
            setError(null);
            setState("sending");
            try {
              await client.resendVerification(email, locale);
              setState("sent");
            } catch (e) {
              const { key, minutes } = accountErrorKey(e, []);
              setError({ key: key === "rateLimited" ? "rateLimited" : "generic", minutes });
              setState("idle");
            }
          }}
          className="border-line-strong hover:bg-muted rounded-lg border px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {state === "sending" ? t("resending") : t("resend")}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-ink-muted text-sm font-medium underline underline-offset-4"
        >
          {t("back")}
        </button>
      </div>
    </div>
  );
}
