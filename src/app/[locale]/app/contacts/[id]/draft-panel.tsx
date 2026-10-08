"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { buttonClass } from "@/components/button";
import { ActionForm, inputClass } from "@/components/form";
import { Icon } from "@/components/icons";
import { MAX_BODY, MAX_SUBJECT } from "@/lib/contact/draft";
import {
  approveDraftAction,
  saveDraftAction,
  sendContactAction,
  type ContactActionState,
} from "../actions";

export const primary = `${buttonClass("primary", "lg")} w-full sm:w-auto`;
export const approveClass = `${buttonClass("approve", "lg")} w-full sm:w-auto`;
export const secondary = `${buttonClass("secondary")} w-full sm:w-auto`;

/**
 * Zone de décision mise en avant (approuver, envoyer) : rien ne part sans le
 * geste explicite de la personne.
 */
export function DecisionZone({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <div className="band-brand border-brand-line rounded-xl border p-4 sm:p-5">
      <p className="text-ink mb-3 flex items-start gap-2 font-medium">
        <Icon name="shield" className="text-brand-ink mt-0.5 size-5 shrink-0" />
        {hint}
      </p>
      {children}
    </div>
  );
}

function ActionMessage({ state }: { state: ContactActionState }) {
  const t = useTranslations("contacts");
  if (state.error) {
    return (
      <p role="alert" className="text-danger-ink flex items-start gap-2 text-sm font-medium">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
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
            <Icon name="edit" className="size-4" />
            {t("save")}
          </button>
          <ActionMessage state={saveState} />
        </div>
      </ActionForm>

      {!approved ? (
        <DecisionZone hint={t("approvalHint")}>
          <form action={approve} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="submit" disabled={approving || dirty} className={approveClass}>
              <Icon name="approve" className="size-5" />
              {t("approve")}
            </button>
            {dirty ? <p className="text-ink-muted text-sm">{t("saveFirst")}</p> : null}
            <ActionMessage state={approveState} />
          </form>
        </DecisionZone>
      ) : channel === "EMAIL" || channel === "PORTAL" ? (
        <DecisionZone hint={t(channel === "PORTAL" ? "sendPortalHint" : "sendHint")}>
          <form action={send} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="submit" disabled={sending || dirty} className={primary}>
              <Icon name="send" className="size-5" />
              {t(channel === "PORTAL" ? "sendPortal" : "send")}
            </button>
            {dirty ? <p className="text-ink-muted text-sm">{t("saveFirst")}</p> : null}
            <ActionMessage state={sendState} />
          </form>
        </DecisionZone>
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
