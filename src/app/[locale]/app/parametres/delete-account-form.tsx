"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  ActionForm,
  Field,
  fieldProps,
  FormError,
  inputClass,
  type FormState,
} from "@/components/form";
import { deleteMyAccount } from "../actions";

export function DeleteAccountForm() {
  const t = useTranslations("settings.delete");
  const [state, action, pending] = useActionState<FormState, FormData>(deleteMyAccount, {});
  const error = state.errors?.confirmEmail;
  return (
    <ActionForm action={action} className="space-y-4">
      {state.errors?._form ? <FormError errors={state.errors} /> : null}
      <Field id="confirmEmail" label={t("confirmLabel")} hint={t("confirmHint")} error={error}>
        <input
          {...fieldProps("confirmEmail", error, "hint")}
          type="email"
          autoComplete="off"
          className={inputClass}
        />
      </Field>
      <button
        type="submit"
        disabled={pending}
        className="bg-danger text-on-danger hover:bg-danger-hover w-full rounded-lg px-5 py-2.5 font-medium disabled:opacity-60 sm:w-auto"
      >
        {pending ? t("deleting") : t("submit")}
      </button>
    </ActionForm>
  );
}
