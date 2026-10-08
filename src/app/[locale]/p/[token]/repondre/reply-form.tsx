"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
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
      <p role="status" className="bg-brand-soft text-brand-ink rounded-lg px-4 py-3 text-sm">
        {t("sent")}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="text-danger-ink text-sm">
          {t(state.error)}
        </p>
      ) : null}
      <div>
        <label htmlFor="body" className="text-ink block text-sm font-medium">
          {t("label")}
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={8}
          maxLength={MAX_REPLY_LENGTH}
          aria-describedby="body-hint"
          className={inputClass}
        />
        <p id="body-hint" className="text-ink-subtle mt-1 text-sm">
          {t("hint")}
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-on-primary hover:bg-primary-hover w-full rounded-lg px-5 py-2.5 font-medium disabled:opacity-60 sm:w-auto"
      >
        {t("submit")}
      </button>
    </form>
  );
}
