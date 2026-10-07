"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import {
  ActionForm,
  Field,
  fieldProps,
  FormError,
  inputClass,
  SavedNotice,
  SubmitButton,
  type FormState,
} from "@/components/form";
import { DOCUMENT_ACCEPT, MAX_DOCUMENT_BYTES } from "@/lib/career/documents";
import { LIMITS } from "@/lib/career/schemas";
import { addProof } from "./actions";

const KINDS = ["URL", "DOCUMENT", "REFERENCE"] as const;
type Kind = (typeof KINDS)[number];

/** Ajout d'une preuve : lien, document privé ou témoignage écrit. */
export function ProofForms({ achievementId }: { achievementId: string }) {
  const t = useTranslations("memory.proofs");
  const [kind, setKind] = useState<Kind>("URL");
  const [state, action, pending] = useActionState<FormState, FormData>(
    addProof.bind(null, achievementId),
    {},
  );
  const e = state.errors ?? {};

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
      <h3 className="font-semibold">{t("addTitle")}</h3>
      <div role="radiogroup" aria-label={t("kindLabel")} className="mt-3 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              kind === k
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-300 bg-white hover:bg-stone-100"
            }`}
          >
            {t(`kinds.${k}`)}
          </button>
        ))}
      </div>

      <ActionForm key={kind} action={action} resetOn={state} className="mt-4 space-y-4">
        <input type="hidden" name="kind" value={kind} />
        <FormError errors={e._form ? state.errors : undefined} />
        {kind === "URL" ? (
          <Field id="url" label={t("urlLabel")} hint={t("urlHint")} error={e.url}>
            <input
              {...fieldProps("url", e.url, "hint")}
              type="url"
              inputMode="url"
              maxLength={LIMITS.url}
              placeholder="https://"
              className={inputClass}
            />
          </Field>
        ) : null}
        {kind === "DOCUMENT" ? (
          <Field
            id="file"
            label={t("fileLabel")}
            hint={t("fileHint", { maxMb: MAX_DOCUMENT_BYTES / (1024 * 1024) })}
            error={e.file}
          >
            <input
              {...fieldProps("file", e.file, "hint")}
              type="file"
              accept={DOCUMENT_ACCEPT}
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:font-medium"
            />
          </Field>
        ) : null}
        {kind === "REFERENCE" ? (
          <Field
            id="referenceText"
            label={t("referenceLabel")}
            hint={t("referenceHint")}
            error={e.referenceText}
          >
            <textarea
              {...fieldProps("referenceText", e.referenceText, "hint")}
              rows={4}
              maxLength={LIMITS.reference}
              className={inputClass}
            />
          </Field>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SubmitButton pending={pending}>{t("add")}</SubmitButton>
          <SavedNotice show={state.ok && !pending} />
        </div>
      </ActionForm>
    </div>
  );
}
