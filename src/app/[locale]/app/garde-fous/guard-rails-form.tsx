"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import {
  ActionForm,
  Field,
  FieldError,
  fieldProps,
  FormError,
  inputClass,
  SavedNotice,
  SubmitButton,
  type FormState,
} from "@/components/form";
import { CONTRACT_TYPES, CULTURE_PREFERENCES, REMOTE_POLICIES, SECTORS } from "@/lib/career/codes";
import type { GuardRailsView } from "@/lib/career/repository";
import { LIMITS } from "@/lib/career/schemas";
import { updateGuardRails } from "./actions";

type Location = { key: string; label: string; radiusKm: number };

const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";
const chipClass =
  "has-[:checked]:border-stone-900 has-[:checked]:bg-stone-900 has-[:checked]:text-white flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm";

export function GuardRailsForm({ initial }: { initial: GuardRailsView }) {
  const t = useTranslations("guardRails");
  const tc = useTranslations("codes");
  const [state, action, pending] = useActionState<FormState, FormData>(updateGuardRails, {});
  const e = state.errors ?? {};
  const baseId = useId();
  const [remotePolicy, setRemotePolicy] = useState<string>(initial.remotePolicy ?? "");
  const [locations, setLocations] = useState<Location[]>(
    initial.locations.map((l) => ({ key: l.id, label: l.label, radiusKm: l.radiusKm })),
  );

  return (
    <ActionForm action={action} className="space-y-6">
      <FormError errors={state.errors} />

      {/* Rémunération */}
      <section className={sectionClass} aria-labelledby="gf-salary">
        <h2 id="gf-salary" className="text-lg font-semibold">
          {t("salary.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">{t("salary.intro")}</p>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            id="minFixedSalary"
            label={t("salary.minFixed")}
            hint={t("salary.amountHint")}
            error={e.minFixedSalary}
          >
            <input
              {...fieldProps("minFixedSalary", e.minFixedSalary, "hint")}
              inputMode="numeric"
              defaultValue={initial.minFixedSalary ?? ""}
              placeholder="45000"
              className={inputClass}
            />
          </Field>
          <Field
            id="targetTotalPackage"
            label={t("salary.targetPackage")}
            hint={t("salary.packageHint")}
            error={e.targetTotalPackage}
            optional
          >
            <input
              {...fieldProps("targetTotalPackage", e.targetTotalPackage, "hint")}
              inputMode="numeric"
              defaultValue={initial.targetTotalPackage ?? ""}
              placeholder="55000"
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {/* Lieux et télétravail */}
      <section className={sectionClass} aria-labelledby="gf-location">
        <h2 id="gf-location" className="text-lg font-semibold">
          {t("location.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">{t("location.intro")}</p>

        {locations.length === 0 ? (
          <p className="mb-3 text-sm text-stone-500">{t("location.empty")}</p>
        ) : (
          <ul className="mb-3 space-y-3">
            {locations.map((location, index) => {
              const labelId = `${baseId}-loc-${location.key}`;
              const labelError = e[`locations.${index}.label`];
              const radiusError = e[`locations.${index}.radiusKm`];
              return (
                <li
                  key={location.key}
                  className="grid gap-3 rounded-xl border border-stone-200 p-3 sm:grid-cols-[1fr_10rem_auto] sm:items-start"
                >
                  <div>
                    <label htmlFor={labelId} className="block text-sm font-medium">
                      {t("location.city")}
                    </label>
                    <input
                      id={labelId}
                      name="locationLabel"
                      defaultValue={location.label}
                      maxLength={LIMITS.locationLabel}
                      placeholder={t("location.cityPlaceholder")}
                      aria-invalid={labelError ? true : undefined}
                      aria-describedby={labelError ? `${labelId}-error` : undefined}
                      className={inputClass}
                    />
                    <FieldError id={labelId} error={labelError} />
                  </div>
                  <div>
                    <label htmlFor={`${labelId}-r`} className="block text-sm font-medium">
                      {t("location.radius")}
                    </label>
                    <input
                      id={`${labelId}-r`}
                      name="locationRadius"
                      type="number"
                      min={0}
                      max={LIMITS.maxRadiusKm}
                      inputMode="numeric"
                      defaultValue={location.radiusKm}
                      aria-invalid={radiusError ? true : undefined}
                      aria-describedby={radiusError ? `${labelId}-r-error` : undefined}
                      className={inputClass}
                    />
                    <FieldError id={`${labelId}-r`} error={radiusError} />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setLocations((list) => list.filter((l) => l.key !== location.key))
                    }
                    className="rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 sm:mt-6"
                  >
                    {t("location.remove")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <FieldError id="locations" error={e.locations} />
        {locations.length < LIMITS.locations ? (
          <button
            type="button"
            onClick={() =>
              setLocations((list) => [
                ...list,
                { key: crypto.randomUUID(), label: "", radiusKm: 30 },
              ])
            }
            className="rounded-lg border border-dashed border-stone-400 px-3 py-2 text-sm font-medium hover:bg-stone-50"
          >
            {t("location.add")}
          </button>
        ) : null}

        <fieldset className="mt-6">
          <legend className="text-sm font-semibold">{t("remote.title")}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(["", ...REMOTE_POLICIES] as const).map((policy) => (
              <label key={policy || "none"} className={chipClass}>
                <input
                  type="radio"
                  name="remotePolicy"
                  value={policy}
                  checked={remotePolicy === policy}
                  onChange={() => setRemotePolicy(policy)}
                  className="sr-only"
                />
                {policy ? tc(`remotePolicy.${policy}`) : t("remote.none")}
              </label>
            ))}
          </div>
          <FieldError id="remotePolicy" error={e.remotePolicy} />
        </fieldset>
        {remotePolicy === "HYBRID" ? (
          <div className="mt-4 max-w-xs">
            <Field id="minRemoteDays" label={t("remote.minDays")} error={e.minRemoteDays}>
              <select
                {...fieldProps("minRemoteDays", e.minRemoteDays)}
                defaultValue={initial.minRemoteDays ?? ""}
                className={inputClass}
              >
                <option value="">{t("remote.chooseDays")}</option>
                {[1, 2, 3, 4, 5].map((days) => (
                  <option key={days} value={days}>
                    {t("remote.days", { count: days })}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
      </section>

      {/* Contrats */}
      <section className={sectionClass} aria-labelledby="gf-contracts">
        <fieldset>
          <legend id="gf-contracts" className="text-lg font-semibold">
            {t("contracts.title")}
          </legend>
          <p className="mt-1 mb-4 text-sm text-stone-600">{t("contracts.intro")}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {CONTRACT_TYPES.map((code) => (
              <label key={code} className={chipClass}>
                <input
                  type="checkbox"
                  name="contractTypes"
                  value={code}
                  defaultChecked={initial.contractTypes.includes(code)}
                  className="accent-brand-700 size-4"
                />
                {tc(`contractType.${code}`)}
              </label>
            ))}
          </div>
          <FieldError id="contractTypes" error={e.contractTypes} />
        </fieldset>
      </section>

      {/* Exclusions */}
      <section className={sectionClass} aria-labelledby="gf-exclusions">
        <h2 id="gf-exclusions" className="text-lg font-semibold">
          {t("exclusions.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">{t("exclusions.intro")}</p>
        <fieldset>
          <legend className="text-sm font-semibold">{t("exclusions.sectors")}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SECTORS.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="excludedSectors"
                  value={code}
                  defaultChecked={initial.excludedSectors.includes(code)}
                  className="accent-brand-700 size-4 shrink-0"
                />
                {tc(`sector.${code}`)}
              </label>
            ))}
          </div>
          <FieldError id="excludedSectors" error={e.excludedSectors} />
        </fieldset>
        <div className="mt-6">
          <Field
            id="excludedCompanies"
            label={t("exclusions.companies")}
            hint={t("exclusions.companiesHint")}
            error={
              e.excludedCompanies ??
              Object.entries(e).find(([k]) => k.startsWith("excludedCompanies."))?.[1]
            }
            optional
          >
            <textarea
              {...fieldProps("excludedCompanies", e.excludedCompanies, "hint")}
              rows={4}
              defaultValue={initial.excludedCompanies.join("\n")}
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {/* Rythme */}
      <section className={sectionClass} aria-labelledby="gf-workload">
        <h2 id="gf-workload" className="text-lg font-semibold">
          {t("workload.title")}
        </h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <Field
            id="maxWeeklyHours"
            label={t("workload.maxHours")}
            hint={t("workload.maxHoursHint")}
            error={e.maxWeeklyHours}
            optional
          >
            <input
              {...fieldProps("maxWeeklyHours", e.maxWeeklyHours, "hint")}
              type="number"
              min={1}
              max={80}
              inputMode="numeric"
              defaultValue={initial.maxWeeklyHours ?? ""}
              className={inputClass}
            />
          </Field>
          <label className="flex items-start gap-3 text-sm sm:mt-7">
            <input
              type="checkbox"
              name="acceptsOnCall"
              defaultChecked={initial.acceptsOnCall}
              className="accent-brand-700 mt-0.5 size-4"
            />
            <span>
              <span className="block font-medium">{t("workload.onCall")}</span>
              <span className="text-stone-500">{t("workload.onCallHint")}</span>
            </span>
          </label>
        </div>
      </section>

      {/* Culture */}
      <section className={sectionClass} aria-labelledby="gf-culture">
        <fieldset>
          <legend id="gf-culture" className="text-lg font-semibold">
            {t("culture.title")}
          </legend>
          <p className="mt-1 mb-4 text-sm text-stone-600">{t("culture.intro")}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CULTURE_PREFERENCES.map((code) => (
              <label key={code} className={chipClass}>
                <input
                  type="checkbox"
                  name="culturePreferences"
                  value={code}
                  defaultChecked={initial.culturePreferences.includes(code)}
                  className="accent-brand-700 size-4"
                />
                {tc(`culture.${code}`)}
              </label>
            ))}
          </div>
          <FieldError id="culturePreferences" error={e.culturePreferences} />
        </fieldset>
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t border-stone-200 bg-stone-50/95 px-4 py-4 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:rounded-xl sm:border">
        <SubmitButton pending={pending}>{t("save")}</SubmitButton>
        <SavedNotice show={state.ok && !pending} />
      </div>
    </ActionForm>
  );
}
