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
import { Link } from "@/i18n/navigation";
import { LIMITS } from "@/lib/career/schemas";
import { saveAchievement } from "./actions";

export type AchievementDefaults = {
  title: string;
  context: string;
  actions: string;
  result: string;
  skills: string;
  experienceId: string;
};

export function AchievementForm({
  id,
  defaults,
  experiences,
}: {
  id: string | null;
  defaults?: AchievementDefaults;
  experiences: { id: string; label: string }[];
}) {
  const t = useTranslations("memory.achievements.form");
  const tm = useTranslations("memory");
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveAchievement.bind(null, id),
    {},
  );
  const e = state.errors ?? {};
  const skillsError = e.skills ?? Object.entries(e).find(([k]) => k.startsWith("skills."))?.[1];

  return (
    <ActionForm action={action} className="space-y-6">
      <FormError errors={state.errors} />

      <Field id="title" label={t("title")} hint={t("titleHint")} error={e.title}>
        <input
          {...fieldProps("title", e.title, "hint")}
          defaultValue={defaults?.title}
          maxLength={LIMITS.achievementTitle}
          className={inputClass}
        />
      </Field>

      <Field id="experienceId" label={t("experience")} error={e.experienceId} optional>
        <select
          {...fieldProps("experienceId", e.experienceId)}
          defaultValue={defaults?.experienceId ?? ""}
          className={inputClass}
        >
          <option value="">{t("noExperience")}</option>
          {experiences.map((experience) => (
            <option key={experience.id} value={experience.id}>
              {experience.label}
            </option>
          ))}
        </select>
      </Field>

      <Field id="context" label={t("context")} hint={t("contextHint")} error={e.context} optional>
        <textarea
          {...fieldProps("context", e.context, "hint")}
          rows={3}
          maxLength={LIMITS.context}
          defaultValue={defaults?.context}
          className={inputClass}
        />
      </Field>

      <Field id="actions" label={t("actions")} hint={t("actionsHint")} error={e.actions}>
        <textarea
          {...fieldProps("actions", e.actions, "hint")}
          rows={4}
          maxLength={LIMITS.actions}
          defaultValue={defaults?.actions}
          className={inputClass}
        />
      </Field>

      <Field id="result" label={t("result")} hint={t("resultHint")} error={e.result} optional>
        <textarea
          {...fieldProps("result", e.result, "hint")}
          rows={2}
          maxLength={LIMITS.result}
          defaultValue={defaults?.result}
          className={inputClass}
        />
      </Field>

      <Field id="skills" label={t("skills")} hint={t("skillsHint")} error={skillsError} optional>
        <input
          {...fieldProps("skills", skillsError, "hint")}
          defaultValue={defaults?.skills}
          placeholder={t("skillsPlaceholder")}
          className={inputClass}
        />
      </Field>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <SubmitButton pending={pending}>{id ? t("save") : t("create")}</SubmitButton>
        <Link
          href="/app/memoire#realisations"
          className="text-center text-sm text-stone-600 underline-offset-4 hover:underline"
        >
          {tm("cancel")}
        </Link>
      </div>
    </ActionForm>
  );
}
