"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  ActionForm,
  Field,
  fieldProps,
  FormError,
  inputClass,
  SubmitButton,
  type FormState,
} from "@/components/form";
import { COMPANY_SIZES, SECTORS } from "@/lib/career/codes";
import { COUNTRIES, EMPLOYER_LIMITS } from "@/lib/employer/schema";
import { createOrganizationAction } from "./actions";

export function OrganizationForm({ countryNames }: { countryNames: Record<string, string> }) {
  const t = useTranslations("employer.signup");
  const tc = useTranslations("codes");
  const [state, action, pending] = useActionState<FormState, FormData>(
    createOrganizationAction,
    {},
  );
  const e = state.errors ?? {};
  return (
    <ActionForm action={action} className="space-y-5">
      <FormError errors={state.errors} />
      <Field id="name" label={t("fields.name")} error={e.name}>
        <input
          {...fieldProps("name", e.name)}
          autoComplete="organization"
          maxLength={EMPLOYER_LIMITS.orgName}
          className={inputClass}
        />
      </Field>
      <Field
        id="website"
        label={t("fields.website")}
        hint={t("fields.websiteHint")}
        error={e.website}
      >
        <input
          {...fieldProps("website", e.website, "hint")}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://"
          maxLength={EMPLOYER_LIMITS.url}
          className={inputClass}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field id="sector" label={t("fields.sector")} error={e.sector}>
          <select {...fieldProps("sector", e.sector)} defaultValue="" className={inputClass}>
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
        <Field id="size" label={t("fields.size")} error={e.size}>
          <select {...fieldProps("size", e.size)} defaultValue="" className={inputClass}>
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
        <Field id="country" label={t("fields.country")} error={e.country}>
          <select {...fieldProps("country", e.country)} defaultValue="FR" className={inputClass}>
            {COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {countryNames[code] ?? code}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
    </ActionForm>
  );
}
