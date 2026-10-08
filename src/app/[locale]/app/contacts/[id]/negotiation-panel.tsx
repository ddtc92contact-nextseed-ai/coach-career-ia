"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";
import { buttonClass } from "@/components/button";
import { ActionForm, inputClass } from "@/components/form";
import { Icon } from "@/components/icons";
import { CONTRACT_TYPES } from "@/lib/career/codes";
import type { NegotiationIssue } from "@/lib/negotiation/check";
import {
  MAX_FACTS,
  MAX_MESSAGE,
  type Mandate,
  type NegotiationOutcome,
} from "@/lib/negotiation/mandate";
import {
  approveMessageAction,
  generateDraftAction,
  markTransmittedAction,
  saveMandateAction,
  sendMessageAction,
  setOutcomeAction,
  updateMessageAction,
  type NegotiationActionState,
} from "../negotiation-actions";
import { approveClass, CopyText, DecisionZone, primary, secondary } from "./draft-panel";

const labelClass = "block text-sm font-medium text-ink";

/** Liste des problèmes bloquants d'un message au regard du mandat. */
export function IssueList({ issues }: { issues: NegotiationIssue[] }) {
  const t = useTranslations("negotiation");
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      className="border-danger-line bg-danger-soft text-danger-ink rounded-xl border px-4 py-3"
    >
      <p className="flex items-center gap-2 font-semibold">
        <Icon name="alert" className="size-5 shrink-0" />
        {t("composer.blocked")}
      </p>
      <ul className="mt-1 list-disc pl-5">
        {issues.map((issue) => (
          <li key={issue.code}>{t(`issues.${issue.code}`, { excerpt: issue.excerpt ?? "" })}</li>
        ))}
      </ul>
    </div>
  );
}

function ActionMessage({ state }: { state: NegotiationActionState }) {
  const t = useTranslations("negotiation");
  const format = useFormatter();
  if (state.error === "invalid" && state.fields) {
    return (
      <p role="alert" className="text-danger-ink flex items-start gap-2 text-sm font-medium">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        {t("mandate.invalid", {
          fields: format.list(state.fields.map((f) => t(`fields.${f}`))),
        })}
      </p>
    );
  }
  if (state.error === "blocked" && state.issues) return <IssueList issues={state.issues} />;
  if (state.error) {
    return (
      <p role="alert" className="text-danger-ink flex items-start gap-2 text-sm font-medium">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        {t(`errors.${state.error}`, { excerpt: state.excerpt ?? "", limit: state.limit ?? 0 })}
      </p>
    );
  }
  if (state.fallback) {
    return (
      <p role="status" className="bg-warning-soft text-warning-ink rounded-lg px-3 py-2 text-sm">
        {t("composer.fallback")}
      </p>
    );
  }
  if (state.ok) {
    const key = state.ok === "saved" ? "composer.saved" : `composer.${state.ok}`;
    return (
      <p role="status" className="text-brand-ink text-sm font-medium">
        {t(key as "composer.saved")}
      </p>
    );
  }
  return null;
}

/** Mandat de négociation (plancher, cible, non négociables, souhaitables, faits). */
export function MandateForm({
  contactId,
  mandate,
  defaults,
}: {
  contactId: string;
  mandate: Mandate | null;
  defaults: Partial<Mandate>;
}) {
  const t = useTranslations("negotiation.mandate");
  const tc = useTranslations("codes.contractType");
  const [state, action, pending] = useActionState<NegotiationActionState, FormData>(
    saveMandateAction.bind(null, contactId),
    {},
  );
  const value = mandate ?? defaults;
  const invalid = (field: string) => state.fields?.includes(field as never) || undefined;
  return (
    <ActionForm action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="salaryFloor" className={labelClass}>
            {t("salaryFloor")}
          </label>
          <input
            id="salaryFloor"
            name="salaryFloor"
            inputMode="numeric"
            required
            defaultValue={value.salaryFloor ?? ""}
            aria-invalid={invalid("salaryFloor")}
            aria-describedby="salaryFloor-hint"
            className={inputClass}
          />
          <p id="salaryFloor-hint" className="text-ink-subtle mt-1 text-sm">
            {t("salaryFloorHint")}
          </p>
        </div>
        <div>
          <label htmlFor="salaryTarget" className={labelClass}>
            {t("salaryTarget")}
          </label>
          <input
            id="salaryTarget"
            name="salaryTarget"
            inputMode="numeric"
            defaultValue={value.salaryTarget ?? ""}
            aria-invalid={invalid("salaryTarget")}
            className={inputClass}
          />
        </div>
      </div>

      <fieldset className="border-line bg-subtle space-y-4 rounded-xl border p-4 sm:p-5">
        <legend className="flex items-center gap-2 px-1 font-semibold">
          <Icon name="shield" className="text-brand-ink size-5" />
          {t("nonNegotiable")}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="remoteDaysMin" className={labelClass}>
              {t("remoteDaysMin")}
            </label>
            <input
              id="remoteDaysMin"
              name="remoteDaysMin"
              type="number"
              min={0}
              max={5}
              defaultValue={value.remoteDaysMin ?? ""}
              aria-invalid={invalid("remoteDaysMin")}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="contractType" className={labelClass}>
              {t("contractType")}
            </label>
            <select
              id="contractType"
              name="contractType"
              defaultValue={value.contractType ?? ""}
              className={inputClass}
            >
              <option value="">{t("contractAny")}</option>
              {CONTRACT_TYPES.map((c) => (
                <option key={c} value={c}>
                  {tc(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="location" className={labelClass}>
              {t("location")}
            </label>
            <input
              id="location"
              name="location"
              maxLength={120}
              defaultValue={value.location ?? ""}
              aria-invalid={invalid("location")}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="startDate" className={labelClass}>
              {t("startDate")}
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={value.startDate ?? ""}
              aria-invalid={invalid("startDate")}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="title" className={labelClass}>
              {t("jobTitle")}
            </label>
            <input
              id="title"
              name="title"
              maxLength={120}
              defaultValue={value.title ?? ""}
              aria-invalid={invalid("title")}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor="otherPoints" className={labelClass}>
            {t("otherPoints")}
          </label>
          <textarea
            id="otherPoints"
            name="otherPoints"
            rows={3}
            defaultValue={(value.otherPoints ?? []).join("\n")}
            aria-invalid={invalid("otherPoints")}
            className={inputClass}
          />
        </div>
      </fieldset>

      <div>
        <label htmlFor="niceToHave" className={labelClass}>
          {t("niceToHave")}
        </label>
        <textarea
          id="niceToHave"
          name="niceToHave"
          rows={3}
          defaultValue={(value.niceToHave ?? []).join("\n")}
          aria-invalid={invalid("niceToHave")}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="facts" className={labelClass}>
          {t("facts")}
        </label>
        <textarea
          id="facts"
          name="facts"
          rows={2}
          maxLength={MAX_FACTS}
          defaultValue={value.facts ?? ""}
          aria-invalid={invalid("facts")}
          aria-describedby="facts-hint"
          className={inputClass}
        />
        <p id="facts-hint" className="text-ink-subtle mt-1 text-sm">
          {t("factsHint")}
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="submit" disabled={pending} className={secondary}>
          <Icon name="check" className="size-4" />
          {t("save")}
        </button>
        {state.ok === "saved" ? (
          <p role="status" className="text-brand-ink text-sm font-medium">
            {t("saved")}
          </p>
        ) : (
          <ActionMessage state={state} />
        )}
      </div>
    </ActionForm>
  );
}

/** « Générer une contre-proposition » / « Rédiger le message de clôture ». */
export function GenerateButton({
  contactId,
  kind,
}: {
  contactId: string;
  kind: "counter" | "closing";
}) {
  const t = useTranslations("negotiation.composer");
  const [state, action, pending] = useActionState<NegotiationActionState>(
    generateDraftAction.bind(null, contactId, kind),
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}
        aria-busy={pending}
      >
        <Icon name="spark" className={`size-5 ${pending ? "motion-safe:animate-pulse" : ""}`} />
        {pending ? t("generating") : t(kind === "counter" ? "generateCounter" : "generateClosing")}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

/** Brouillon en cours : modification, approbation explicite, envoi ou texte à transmettre. */
export function MessageEditor({
  contactId,
  id,
  body,
  approved,
  channel,
}: {
  contactId: string;
  id: string;
  body: string;
  approved: boolean;
  channel: "EMAIL" | "APPLY_URL" | "PORTAL";
}) {
  const t = useTranslations("negotiation.composer");
  const [saveState, save, saving] = useActionState<NegotiationActionState, FormData>(
    updateMessageAction.bind(null, contactId, id),
    {},
  );
  const [approveState, approve, approving] = useActionState<NegotiationActionState>(
    approveMessageAction.bind(null, contactId, id),
    {},
  );
  const [sendState, send, sending] = useActionState<NegotiationActionState>(
    sendMessageAction.bind(null, contactId, id),
    {},
  );
  // Un texte modifié mais pas encore enregistré ne peut être ni approuvé ni envoyé.
  const [edits, setEdits] = useState(0);
  const [submitted, setSubmitted] = useState(0);
  const dirty = edits > 0 && !(saveState.ok === "saved" && submitted === edits);

  return (
    <div className="space-y-4">
      <ActionForm
        action={(formData) => {
          setSubmitted(edits);
          save(formData);
        }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="negotiation-body" className={labelClass}>
            {t("body")}
          </label>
          <textarea
            id="negotiation-body"
            name="body"
            defaultValue={body}
            maxLength={MAX_MESSAGE}
            rows={14}
            onChange={() => setEdits((n) => n + 1)}
            aria-describedby="negotiation-body-hint"
            className={inputClass}
          />
          <p id="negotiation-body-hint" className="text-ink-subtle mt-1 text-sm">
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
          <form action={approve} className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button type="submit" disabled={approving || dirty} className={approveClass}>
                <Icon name="approve" className="size-5" />
                {t("approve")}
              </button>
              {dirty ? <p className="text-ink-muted text-sm">{t("saveFirst")}</p> : null}
            </div>
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

/** Texte approuvé à transmettre soi-même (offre sans adresse). */
export function PasteBlock({
  contactId,
  id,
  text,
}: {
  contactId: string;
  id: string;
  text: string;
}) {
  const t = useTranslations("negotiation.composer");
  return (
    <div className="band-brand border-brand-line space-y-3 rounded-xl border p-4 sm:p-5">
      <h3 className="text-lg font-semibold">{t("paste")}</h3>
      <p className="text-ink-muted">{t("pasteHint")}</p>
      <CopyText text={text} />
      <form action={markTransmittedAction.bind(null, contactId, id)}>
        <button type="submit" className={primary}>
          <Icon name="check" className="size-5" />
          {t("markTransmitted")}
        </button>
      </form>
    </div>
  );
}

/** Décision du candidat : jamais prise par l'agent. */
export function OutcomeButtons({
  contactId,
  status,
}: {
  contactId: string;
  status: NegotiationOutcome;
}) {
  const t = useTranslations("negotiation.outcome");
  const [pending, startTransition] = useTransition();
  const choose = (outcome: NegotiationOutcome, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    startTransition(async () => {
      await setOutcomeAction(contactId, outcome);
    });
  };
  const button = (outcome: NegotiationOutcome, label: string, confirm?: string) => (
    <button
      key={outcome}
      type="button"
      disabled={pending}
      onClick={() => choose(outcome, confirm)}
      className={outcome === "ACCEPTED" ? approveClass : secondary}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {status === "ACTIVE" ? (
        <>
          {button("ACCEPTED", t("accept"), t("acceptConfirm"))}
          {button("DECLINED", t("decline"))}
          {button("PAUSED", t("pause"))}
        </>
      ) : (
        button("ACTIVE", t("resume"))
      )}
    </div>
  );
}
