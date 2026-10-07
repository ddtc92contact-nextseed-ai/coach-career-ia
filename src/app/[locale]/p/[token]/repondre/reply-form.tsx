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
      <p role="status" className="bg-brand-50 text-brand-800 rounded-lg px-4 py-3 text-sm">
        {t("sent")}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {t(state.error)}
        </p>
      ) : null}
      <div>
        <label htmlFor="body" className="block text-sm font-medium text-stone-800">
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
        <p id="body-hint" className="mt-1 text-sm text-stone-500">
          {t("hint")}
        </p>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-stone-900 px-5 py-2.5 font-medium text-white hover:bg-stone-700 disabled:opacity-60 sm:w-auto"
      >
        {t("submit")}
      </button>
    </form>
  );
}
