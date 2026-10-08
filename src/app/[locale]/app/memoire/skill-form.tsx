"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ActionForm, FieldError, inputClass, type FormState } from "@/components/form";
import { LIMITS } from "@/lib/career/schemas";
import { addSkill } from "./actions";

export function SkillForm() {
  const t = useTranslations("memory.skills");
  const [state, action, pending] = useActionState<FormState, FormData>(addSkill, {});
  return (
    <ActionForm action={action} resetOn={state}>
      <label htmlFor="skill-name" className="block text-sm font-medium">
        {t("addLabel")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="skill-name"
          name="name"
          maxLength={LIMITS.skillName}
          placeholder={t("addPlaceholder")}
          aria-invalid={state.errors?.name ? true : undefined}
          aria-describedby={state.errors?.name ? "skill-name-error" : "skill-name-hint"}
          className={`${inputClass} sm:max-w-sm`}
        />
        <button
          type="submit"
          disabled={pending}
          className="border-line-strong hover:bg-muted mt-1 rounded-lg border px-4 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {t("addButton")}
        </button>
      </div>
      <p id="skill-name-hint" className="text-ink-subtle mt-1.5 text-sm">
        {t("addHint")}
      </p>
      <FieldError id="skill-name" error={state.errors?.name} />
    </ActionForm>
  );
}
