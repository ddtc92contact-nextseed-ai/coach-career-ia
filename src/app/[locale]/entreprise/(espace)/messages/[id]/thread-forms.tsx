"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef, useTransition } from "react";
import { inputClass } from "@/components/form";
import { MAX_REPLY_LENGTH } from "@/lib/contact/config";
import { closeThreadAction, replyThreadAction, type ThreadActionState } from "../actions";

export function ThreadReplyForm({ id }: { id: string }) {
  const t = useTranslations("employer.inbox");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ThreadActionState, FormData>(
    async (prev, formData) => {
      const next = await replyThreadAction(id, prev, formData);
      if (next.ok) formRef.current?.reset();
      return next;
    },
    {},
  );
  return (
    <form ref={formRef} action={action} className="space-y-3">
      <div>
        <label htmlFor="reply-body" className="block text-sm font-medium text-stone-800">
          {t("replyLabel")}
        </label>
        <textarea
          id="reply-body"
          name="body"
          required
          rows={6}
          maxLength={MAX_REPLY_LENGTH}
          aria-describedby="reply-hint"
          className={inputClass}
        />
        <p id="reply-hint" className="mt-1 text-sm text-stone-500">
          {t("replyHint")}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-stone-900 px-5 py-2.5 font-medium text-white hover:bg-stone-700 disabled:opacity-60 sm:w-auto"
        >
          {t("replySubmit")}
        </button>
        {state.error ? (
          <p role="alert" className="text-sm text-red-700">
            {t(`errors.${state.error}`)}
          </p>
        ) : state.ok ? (
          <p role="status" className="text-brand-700 text-sm font-medium">
            {t("replySent")}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Clôture polie : un message type est envoyé au candidat, après confirmation. */
export function CloseThreadButton({ id }: { id: string }) {
  const t = useTranslations("employer.inbox");
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(t("closeConfirm"))) return;
        startTransition(async () => {
          await closeThreadAction(id);
        });
      }}
      className="w-full rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-60 sm:w-auto"
    >
      {pending ? t("closing.pending") : t("close")}
    </button>
  );
}
