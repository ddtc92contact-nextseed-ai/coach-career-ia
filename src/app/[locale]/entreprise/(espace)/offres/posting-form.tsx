"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
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
import { Card, CardHeader } from "@/components/card";
import { CONTRACT_TYPES, SECTORS, SENIORITIES } from "@/lib/career/codes";
import {
  COUNTRIES,
  EMPLOYER_LIMITS,
  POSTING_REMOTE_POLICIES,
  SALARY_CURRENCIES,
  SALARY_PERIODS,
} from "@/lib/employer/schema";

export type PostingFormValues = {
  title: string;
  description: string;
  contractType: string;
  remotePolicy: string;
  city: string;
  country: string;
  seniority: string;
  sector: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  salaryPeriod: string;
};

export const EMPTY_POSTING: PostingFormValues = {
  title: "",
  description: "",
  contractType: "",
  remotePolicy: "",
  city: "",
  country: "FR",
  seniority: "",
  sector: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "EUR",
  salaryPeriod: "YEAR",
};

export function PostingForm({
  action,
  initial,
  submitLabel,
  countryNames,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  initial: PostingFormValues;
  submitLabel: string;
  countryNames: Record<string, string>;
}) {
  const t = useTranslations("employer.posting");
  const ts = useTranslations("employer.signup");
  const tc = useTranslations("codes");
  const to = useTranslations("opportunities");
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const e = state.errors ?? {};

  const select = <T extends string>(
    id: keyof PostingFormValues,
    options: readonly T[],
    label: (code: T) => string,
    placeholder = true,
  ) => (
    <select {...fieldProps(id, e[id])} defaultValue={initial[id]} className={inputClass}>
      {placeholder ? (
        <option value="" disabled>
          {ts("choose")}
        </option>
      ) : null}
      {options.map((code) => (
        <option key={code} value={code}>
          {label(code)}
        </option>
      ))}
    </select>
  );

  return (
    <ActionForm action={formAction} className="space-y-6">
      <FormError errors={state.errors} />

      <Card aria-labelledby="posting-job">
        <CardHeader id="posting-job" title={t("sections.job")} />
        <div className="mt-5 space-y-5">
          <Field id="title" label={t("fields.title")} error={e.title}>
            <input
              {...fieldProps("title", e.title)}
              defaultValue={initial.title}
              maxLength={EMPLOYER_LIMITS.title}
              className={inputClass}
            />
          </Field>
          <Field
            id="description"
            label={t("fields.description")}
            hint={t("fields.descriptionHint", { min: EMPLOYER_LIMITS.descriptionMin })}
            error={e.description}
          >
            <textarea
              {...fieldProps("description", e.description, "hint")}
              defaultValue={initial.description}
              rows={12}
              maxLength={EMPLOYER_LIMITS.description}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="seniority" label={t("fields.seniority")} error={e.seniority}>
              {select("seniority", SENIORITIES, (c) => tc(`seniority.${c}`))}
            </Field>
            <Field id="sector" label={t("fields.sector")} error={e.sector}>
              {select("sector", SECTORS, (c) => tc(`sector.${c}`))}
            </Field>
          </div>
        </div>
      </Card>

      <Card aria-labelledby="posting-place">
        <CardHeader id="posting-place" title={t("sections.place")} />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field id="contractType" label={t("fields.contractType")} error={e.contractType}>
            {select("contractType", CONTRACT_TYPES, (c) => to(`contract.${c}`))}
          </Field>
          <Field id="remotePolicy" label={t("fields.remotePolicy")} error={e.remotePolicy}>
            {select("remotePolicy", POSTING_REMOTE_POLICIES, (c) => to(`remote.${c}`))}
          </Field>
          <Field id="city" label={t("fields.city")} error={e.city}>
            <input
              {...fieldProps("city", e.city)}
              defaultValue={initial.city}
              autoComplete="address-level2"
              maxLength={EMPLOYER_LIMITS.city}
              className={inputClass}
            />
          </Field>
          <Field id="country" label={t("fields.country")} error={e.country}>
            {select("country", COUNTRIES, (c) => countryNames[c] ?? c, false)}
          </Field>
        </div>
      </Card>

      <Card aria-labelledby="posting-salary">
        <CardHeader
          id="posting-salary"
          title={t("sections.salary")}
          description={t("salaryIntro")}
        />
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="salaryMin" label={t("fields.salaryMin")} error={e.salaryMin}>
            <input
              {...fieldProps("salaryMin", e.salaryMin)}
              defaultValue={initial.salaryMin}
              inputMode="numeric"
              required
              placeholder="45000"
              className={inputClass}
            />
          </Field>
          <Field id="salaryMax" label={t("fields.salaryMax")} error={e.salaryMax}>
            <input
              {...fieldProps("salaryMax", e.salaryMax)}
              defaultValue={initial.salaryMax}
              inputMode="numeric"
              required
              placeholder="55000"
              className={inputClass}
            />
          </Field>
          <Field id="salaryCurrency" label={t("fields.salaryCurrency")} error={e.salaryCurrency}>
            {select("salaryCurrency", SALARY_CURRENCIES, (c) => c, false)}
          </Field>
          <Field id="salaryPeriod" label={t("fields.salaryPeriod")} error={e.salaryPeriod}>
            {select("salaryPeriod", SALARY_PERIODS, (c) => t(`periods.${c}`), false)}
          </Field>
        </div>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
        <SavedNotice show={state.ok} />
      </div>
    </ActionForm>
  );
}
