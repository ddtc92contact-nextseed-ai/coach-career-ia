"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { ActionForm, inputClass } from "@/components/form";
import { MAX_BODY, MAX_SUBJECT } from "@/lib/contact/draft";
import {
  approveDraftAction,
  saveDraftAction,
  sendContactAction,
  type ContactActionState,
} from "../actions";

const primary =
  "w-full rounded-lg bg-primary px-5 py-2.5 font-medium text-on-primary hover:bg-primary-hover disabled:opacity-60 sm:w-auto";
const approveClass =
  "bg-brand hover:bg-brand-hover w-full rounded-lg px-5 py-2.5 font-medium text-on-brand disabled:opacity-60 sm:w-auto";
const secondary =
  "w-full rounded-lg border border-line-strong px-5 py-2.5 font-medium hover:bg-muted disabled:opacity-60 sm:w-auto";

function ActionMessage({ state }: { state: ContactActionState }) {
  const t = useTranslations("contacts");
  if (state.error) {
    return (
      <p role="alert" className="text-danger-ink text-sm">
        {t(`errors.${state.error}`, { excerpt: state.excerpt ?? "", limit: state.limit ?? 0 })}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="text-brand-ink text-sm font-medium">
        {t(`detail.${state.ok}`)}
      </p>
    );
  }
  return null;
}

/** Brouillon modifiable, puis approbation explicite et (canal e-mail) envoi. */
export function DraftPanel({
  id,
  channel,
  subject,
  body,
  approved,
}: {
  id: string;
  channel: "EMAIL" | "APPLY_URL" | "PORTAL";
  subject: string;
  body: string;
  approved: boolean;
}) {
  const t = useTranslations("contacts.detail");
  const [saveState, save, saving] = useActionState<ContactActionState, FormData>(
    saveDraftAction.bind(null, id),
    {},
  );
  const [approveState, approve, approving] = useActionState<ContactActionState>(
    approveDraftAction.bind(null, id),
    {},
  );
  const [sendState, send, sending] = useActionState<ContactActionState>(
    sendContactAction.bind(null, id),
    {},
  );
  // Un texte modifié mais pas encore enregistré ne peut être ni approuvé ni envoyé.
  // Nombre de modifications, et celui du dernier enregistrement envoyé : le
  // texte n'est « propre » qu'après un enregistrement RÉUSSI de la dernière version.
  const [edits, setEdits] = useState(0);
  const [submitted, setSubmitted] = useState(0);
  const dirty = edits > 0 && !(saveState.ok === "saved" && submitted === edits);

  return (
    <div className="space-y-6">
      <ActionForm
        action={(formData) => {
          setSubmitted(edits);
          save(formData);
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="subject" className="text-ink block text-sm font-medium">
            {t("subject")}
          </label>
          <input
            id="subject"
            name="subject"
            defaultValue={subject}
            maxLength={MAX_SUBJECT}
            onChange={() => setEdits((n) => n + 1)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="body" className="text-ink block text-sm font-medium">
            {t("body")}
          </label>
          <textarea
            id="body"
            name="body"
            defaultValue={body}
            maxLength={MAX_BODY}
            rows={14}
            onChange={() => setEdits((n) => n + 1)}
            aria-describedby="body-hint"
            className={inputClass}
          />
          <p id="body-hint" className="text-ink-subtle mt-1 text-sm">
            {t(channel === "PORTAL" ? "appendedPortal" : "appended")}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="submit" disabled={saving} className={secondary}>
            {t("save")}
          </button>
          <ActionMessage state={saveState} />
        </div>
      </ActionForm>

      {!approved ? (
        <form action={approve} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="submit" disabled={approving || dirty} className={approveClass}>
            {t("approve")}
          </button>
          <ActionMessage state={approveState} />
        </form>
      ) : channel === "EMAIL" || channel === "PORTAL" ? (
        <form action={send} className="space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="submit" disabled={sending || dirty} className={primary}>
              {t(channel === "PORTAL" ? "sendPortal" : "send")}
            </button>
            <ActionMessage state={sendState} />
          </div>
          <p className="text-ink-subtle text-xs">
            {t(channel === "PORTAL" ? "sendPortalHint" : "sendHint")}
          </p>
        </form>
      ) : null}
    </div>
  );
}

/** Copie du texte à coller sur la page « Postuler ». */
export function CopyText({ text, rows = 12 }: { text: string; rows?: number }) {
  const t = useTranslations("contacts.detail");
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <textarea readOnly value={text} rows={rows} aria-label={t("paste")} className={inputClass} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={secondary}
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {t("copy")}
        </button>
        {copied ? (
          <span role="status" className="text-brand-ink text-sm">
            {t("copied")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
