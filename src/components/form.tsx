"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useTransition, type ReactNode } from "react";
import { buttonClass } from "@/components/button";
import type { FieldErrors, ValidationError } from "@/lib/career/schemas";

/** État renvoyé par les actions serveur des formulaires. */
export type FormState = { ok?: boolean; errors?: FieldErrors };

export const inputClass =
  "mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base text-ink shadow-xs transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-3 focus:ring-brand/20 focus:outline-none aria-[invalid=true]:border-danger sm:text-sm";

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
    <p id={`${id}-error`} role="alert" className="text-danger-ink mt-1.5 text-sm">
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
      className="border-danger-line bg-danger-soft text-danger-ink rounded-lg border px-4 py-3 text-sm"
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
      <label htmlFor={id} className="text-ink block text-sm font-medium">
        {label}
        {optional ? <span className="text-ink-subtle font-normal"> ({t("optional")})</span> : null}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-ink-subtle mt-0.5 text-sm">
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
      className={`${buttonClass("primary")} w-full px-5 text-base sm:w-auto`}
    >
      {pending ? t("saving") : children}
    </button>
  );
}

export function SavedNotice({ show }: { show?: boolean }) {
  const t = useTranslations("common");
  if (!show) return null;
  return (
    <p role="status" className="text-brand-ink text-sm font-medium">
      {t("saved")}
    </p>
  );
}
