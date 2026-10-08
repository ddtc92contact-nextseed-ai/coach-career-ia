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
      <p className="text-sm break-words text-stone-700">
        {reason === "signup" ? t("text", { email }) : t("unverified", { email })}
      </p>
      <p className="text-sm text-stone-500">{t("help")}</p>
      {state === "sent" ? (
        <p className="text-brand-700 text-sm font-medium">{t("resent")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
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
          className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium hover:bg-stone-100 disabled:opacity-60"
        >
          {state === "sending" ? t("resending") : t("resend")}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-medium text-stone-700 underline underline-offset-4"
        >
          {t("back")}
        </button>
      </div>
    </div>
  );
}
