"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  ActionForm,
  FieldError,
  SavedNotice,
  SubmitButton,
  type FormState,
} from "@/components/form";
import { VISIBILITY_STATUSES, type VisibilityStatusCode } from "@/lib/career/codes";
import { updateVisibility } from "./actions";

export function VisibilityForm({ current }: { current: VisibilityStatusCode }) {
  const t = useTranslations("dashboard.visibility");
  const tc = useTranslations("codes.visibility");
  const [state, action, pending] = useActionState<FormState, FormData>(updateVisibility, {});

  return (
    <ActionForm action={action} className="space-y-4">
      <fieldset>
        <legend className="sr-only">{t("title")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {VISIBILITY_STATUSES.map((status) => (
            <label
              key={status}
              className="flex cursor-pointer gap-3 rounded-xl border border-stone-200 bg-white p-4 has-[:checked]:border-stone-900 has-[:checked]:ring-1 has-[:checked]:ring-stone-900"
            >
              <input
                type="radio"
                name="visibility"
                value={status}
                defaultChecked={status === current}
                className="accent-brand-700 mt-1"
              />
              <span>
                <span className="block font-medium">{tc(`${status}.label`)}</span>
                <span className="mt-1 block text-sm text-stone-500">
                  {tc(`${status}.description`)}
                </span>
              </span>
            </label>
          ))}
        </div>
        <FieldError id="visibility" error={state.errors?.visibility} />
      </fieldset>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pending={pending}>{t("save")}</SubmitButton>
        <SavedNotice show={state.ok && !pending} />
      </div>
    </ActionForm>
  );
}
