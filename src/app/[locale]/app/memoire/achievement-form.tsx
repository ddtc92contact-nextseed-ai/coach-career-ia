"use client";

import { useTranslations } from "next-intl";
import { useActionState, type ReactNode } from "react";
import { Card, CardHeader } from "@/components/card";
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

/** Étape numérotée du récit (contexte → action → résultat). */
function StoryStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <span
        aria-hidden="true"
        className="bg-brand-soft text-brand-ink font-display inline-flex size-9 shrink-0 items-center justify-center rounded-full text-lg font-bold"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

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

      <Card aria-labelledby="realisation-essentiel">
        <CardHeader id="realisation-essentiel" icon="spark" title={t("groups.essentials")} />
        <div className="mt-6 space-y-6">
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

          <Field
            id="skills"
            label={t("skills")}
            hint={t("skillsHint")}
            error={skillsError}
            optional
          >
            <input
              {...fieldProps("skills", skillsError, "hint")}
              defaultValue={defaults?.skills}
              placeholder={t("skillsPlaceholder")}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <Card aria-labelledby="realisation-recit">
        <CardHeader
          id="realisation-recit"
          icon="flag"
          title={t("groups.story")}
          description={t("groups.storyIntro")}
        />
        <div className="mt-6 space-y-6">
          <StoryStep n={1}>
            <Field
              id="context"
              label={t("context")}
              hint={t("contextHint")}
              error={e.context}
              optional
            >
              <textarea
                {...fieldProps("context", e.context, "hint")}
                rows={4}
                maxLength={LIMITS.context}
                defaultValue={defaults?.context}
                className={inputClass}
              />
            </Field>
          </StoryStep>
          <StoryStep n={2}>
            <Field id="actions" label={t("actions")} hint={t("actionsHint")} error={e.actions}>
              <textarea
                {...fieldProps("actions", e.actions, "hint")}
                rows={5}
                maxLength={LIMITS.actions}
                defaultValue={defaults?.actions}
                className={inputClass}
              />
            </Field>
          </StoryStep>
          <StoryStep n={3}>
            <Field id="result" label={t("result")} hint={t("resultHint")} error={e.result} optional>
              <textarea
                {...fieldProps("result", e.result, "hint")}
                rows={3}
                maxLength={LIMITS.result}
                defaultValue={defaults?.result}
                className={inputClass}
              />
            </Field>
          </StoryStep>
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:px-2">
        <SubmitButton pending={pending}>{id ? t("save") : t("create")}</SubmitButton>
        <Link
          href="/app/memoire#realisations"
          className="text-ink-muted inline-flex min-h-11 items-center justify-center px-3 font-medium underline-offset-4 hover:underline"
        >
          {tm("cancel")}
        </Link>
      </div>
    </ActionForm>
  );
}
