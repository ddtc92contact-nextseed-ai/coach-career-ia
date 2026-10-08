"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import {
  ActionForm,
  Field,
  fieldProps,
  FormError,
  inputClass,
  SubmitButton,
  type FormState,
} from "@/components/form";
import { Link } from "@/i18n/navigation";
import {
  COMPANY_SIZES,
  COMPANY_STAGES,
  CONTRACT_TYPES,
  SECTORS,
  SENIORITIES,
} from "@/lib/career/codes";
import { currentMonth, LIMITS } from "@/lib/career/schemas";
import { saveExperience } from "./actions";

export type ExperienceDefaults = {
  roleTitle: string;
  startMonth: string;
  endMonth: string;
  seniority: string;
  contractType: string;
  sector: string;
  companySize: string;
  companyStage: string;
  responsibilities: string;
};

export function ExperienceForm({
  id,
  defaults,
}: {
  id: string | null;
  defaults?: ExperienceDefaults;
}) {
  const t = useTranslations("memory.experiences.form");
  const tc = useTranslations("codes");
  const tm = useTranslations("memory");
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveExperience.bind(null, id),
    {},
  );
  const [current, setCurrent] = useState(Boolean(defaults && !defaults.endMonth));
  const e = state.errors ?? {};
  const max = currentMonth();

  return (
    <ActionForm action={action} className="space-y-6">
      <FormError errors={state.errors} />

      <Field id="roleTitle" label={t("roleTitle")} hint={t("roleTitleHint")} error={e.roleTitle}>
        <input
          {...fieldProps("roleTitle", e.roleTitle, "hint")}
          defaultValue={defaults?.roleTitle}
          maxLength={LIMITS.roleTitle}
          className={inputClass}
        />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="startMonth" label={t("startMonth")} hint={t("monthHint")} error={e.startMonth}>
          <input
            {...fieldProps("startMonth", e.startMonth, "hint")}
            type="month"
            max={max}
            placeholder="2023-09"
            defaultValue={defaults?.startMonth}
            className={inputClass}
          />
        </Field>
        <div>
          <Field id="endMonth" label={t("endMonth")} hint={t("monthHint")} error={e.endMonth}>
            <input
              {...fieldProps("endMonth", e.endMonth, "hint")}
              type="month"
              max={max}
              placeholder="2025-06"
              disabled={current}
              defaultValue={defaults?.endMonth}
              className={`${inputClass} disabled:bg-muted disabled:text-ink-subtle`}
            />
          </Field>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="current"
              checked={current}
              onChange={(event) => setCurrent(event.target.checked)}
              className="accent-brand size-4"
            />
            {t("current")}
          </label>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="seniority" label={t("seniority")} error={e.seniority}>
          <select
            {...fieldProps("seniority", e.seniority)}
            defaultValue={defaults?.seniority ?? ""}
            className={inputClass}
          >
            <option value="" disabled>
              {t("choose")}
            </option>
            {SENIORITIES.map((code) => (
              <option key={code} value={code}>
                {tc(`seniority.${code}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="contractType" label={t("contractType")} error={e.contractType}>
          <select
            {...fieldProps("contractType", e.contractType)}
            defaultValue={defaults?.contractType ?? ""}
            className={inputClass}
          >
            <option value="" disabled>
              {t("choose")}
            </option>
            {CONTRACT_TYPES.map((code) => (
              <option key={code} value={code}>
                {tc(`contractType.${code}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="border-line bg-subtle rounded-xl border p-4">
        <legend className="px-1 text-sm font-semibold">{t("employerTitle")}</legend>
        <p className="text-ink-muted mb-4 text-sm">{t("employerHint")}</p>
        <div className="grid gap-6 sm:grid-cols-3">
          <Field id="sector" label={t("sector")} error={e.sector}>
            <select
              {...fieldProps("sector", e.sector)}
              defaultValue={defaults?.sector ?? ""}
              className={inputClass}
            >
              <option value="" disabled>
                {t("choose")}
              </option>
              {SECTORS.map((code) => (
                <option key={code} value={code}>
                  {tc(`sector.${code}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="companySize" label={t("companySize")} error={e.companySize}>
            <select
              {...fieldProps("companySize", e.companySize)}
              defaultValue={defaults?.companySize ?? ""}
              className={inputClass}
            >
              <option value="" disabled>
                {t("choose")}
              </option>
              {COMPANY_SIZES.map((code) => (
                <option key={code} value={code}>
                  {tc(`companySize.${code}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="companyStage" label={t("companyStage")} error={e.companyStage}>
            <select
              {...fieldProps("companyStage", e.companyStage)}
              defaultValue={defaults?.companyStage ?? ""}
              className={inputClass}
            >
              <option value="" disabled>
                {t("choose")}
              </option>
              {COMPANY_STAGES.map((code) => (
                <option key={code} value={code}>
                  {tc(`companyStage.${code}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <Field
        id="responsibilities"
        label={t("responsibilities")}
        hint={t("responsibilitiesHint")}
        error={e.responsibilities}
        optional
      >
        <textarea
          {...fieldProps("responsibilities", e.responsibilities, "hint")}
          rows={5}
          maxLength={LIMITS.responsibilities}
          defaultValue={defaults?.responsibilities}
          className={inputClass}
        />
      </Field>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <SubmitButton pending={pending}>{t("save")}</SubmitButton>
        <Link
          href="/app/memoire#experiences"
          className="text-ink-muted text-center text-sm underline-offset-4 hover:underline"
        >
          {tm("cancel")}
        </Link>
      </div>
    </ActionForm>
  );
}
