"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  ActionForm,
  FormError,
  inputClass,
  SavedNotice,
  SubmitButton,
  type FormState,
} from "@/components/form";
import { ALERT_FREQUENCIES, ALERT_MIN_SCORES } from "@/lib/matching/alerts";
import { updateAlertSettings } from "./actions";

export function AlertsForm({
  frequency,
  minScore,
}: {
  frequency: (typeof ALERT_FREQUENCIES)[number];
  minScore: number;
}) {
  const t = useTranslations("settings.alerts");
  const [state, action, pending] = useActionState<FormState, FormData>(updateAlertSettings, {});
  return (
    <ActionForm action={action} className="space-y-4">
      <FormError errors={state.errors} />
      <fieldset>
        <legend className="text-sm font-medium text-stone-800">{t("frequency")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {ALERT_FREQUENCIES.map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200 px-3 py-2.5 text-sm has-[:checked]:border-stone-900 has-[:checked]:ring-1 has-[:checked]:ring-stone-900"
            >
              <input
                type="radio"
                name="frequency"
                value={value}
                defaultChecked={value === frequency}
                className="accent-brand-700"
              />
              {t(`frequencyOptions.${value}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:w-60">
        <label htmlFor="minScore" className="block text-sm font-medium text-stone-800">
          {t("minScore")}
        </label>
        <p id="minScore-hint" className="mt-0.5 text-sm text-stone-500">
          {t("minScoreHint")}
        </p>
        <select
          id="minScore"
          name="minScore"
          defaultValue={String(minScore)}
          aria-describedby="minScore-hint"
          className={inputClass}
        >
          {ALERT_MIN_SCORES.map((value) => (
            <option key={value} value={value}>
              {value}/100
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pending={pending}>{t("save")}</SubmitButton>
        <SavedNotice show={state.ok && !pending} />
      </div>
    </ActionForm>
  );
}
