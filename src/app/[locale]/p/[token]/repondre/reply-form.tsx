"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { buttonClass } from "@/components/button";
import { inputClass } from "@/components/form";
import { MAX_REPLY_LENGTH } from "@/lib/contact/config";
import { submitReply, type ReplyState } from "./actions";

export function ReplyForm({ token }: { token: string }) {
  const t = useTranslations("replyPage");
  const [state, action, pending] = useActionState<ReplyState, FormData>(
    submitReply.bind(null, token),
    {},
  );
  if (state.ok) {
    return (
      <p
        role="status"
        className="border-brand-line bg-brand-soft text-brand-ink rounded-xl border px-4 py-3 font-medium"
      >
        {t("sent")}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-5">
      {state.error ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink rounded-xl border px-4 py-3"
        >
          {t(state.error)}
        </p>
      ) : null}
      <div>
        <label htmlFor="body" className="text-ink block font-semibold">
          {t("label")}
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={8}
          maxLength={MAX_REPLY_LENGTH}
          aria-describedby="body-hint"
          className={`${inputClass} sm:text-base`}
        />
        <p id="body-hint" className="text-ink-muted mt-2 text-base text-pretty">
          {t("hint")}
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}
      >
        {t("submit")}
      </button>
    </form>
  );
}
