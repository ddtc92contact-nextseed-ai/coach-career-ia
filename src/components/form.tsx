"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useTransition, type ReactNode } from "react";
import type { FieldErrors, ValidationError } from "@/lib/career/schemas";

/** État renvoyé par les actions serveur des formulaires. */
export type FormState = { ok?: boolean; errors?: FieldErrors };

export const inputClass =
  "focus:border-brand-600 mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base shadow-xs placeholder:text-stone-400 focus:outline-none aria-[invalid=true]:border-red-600 sm:text-sm";

/**
 * Formulaire qui appelle une action sans réinitialiser les champs (les
 * valeurs saisies restent en place quand la validation échoue).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOn,
}: {
  action: (formData: FormData) => void;
  children: ReactNode;
  className?: string;
  /** Vide le formulaire quand cet état signale un succès (ajout dans une liste). */
  resetOn?: FormState;
}) {
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOn?.ok) ref.current?.reset();
  }, [resetOn]);
  return (
    <form
      ref={ref}
      noValidate
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
    >
      {children}
    </form>
  );
}

export function FieldError({ id, error }: { id: string; error?: ValidationError }) {
  const t = useTranslations("errors");
  if (!error) return null;
  return (
    <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-red-700">
      {t(error)}
    </p>
  );
}

export function FormError({ errors }: { errors?: FieldErrors }) {
  const t = useTranslations("errors");
  const count = errors ? Object.keys(errors).length : 0;
  if (!count) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {errors?._form ? t(errors._form) : t("summary", { count })}
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: ValidationError;
  optional?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
        {optional ? <span className="font-normal text-stone-500"> ({t("optional")})</span> : null}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="mt-0.5 text-sm text-stone-500">
          {hint}
        </p>
      ) : null}
      {children}
      <FieldError id={id} error={error} />
    </div>
  );
}

/** Attributs d'accessibilité d'un champ selon son erreur et son aide. */
export function fieldProps(id: string, error?: ValidationError, hint?: string) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return {
    id,
    name: id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  } as const;
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  const t = useTranslations("common");
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-stone-900 px-5 py-2.5 font-medium text-white hover:bg-stone-700 disabled:opacity-60 sm:w-auto"
    >
      {pending ? t("saving") : children}
    </button>
  );
}

export function SavedNotice({ show }: { show?: boolean }) {
  const t = useTranslations("common");
  if (!show) return null;
  return (
    <p role="status" className="text-brand-700 text-sm font-medium">
      {t("saved")}
    </p>
  );
}
