"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { inputClass } from "@/components/form";
import {
  MIN_PASSWORD_LENGTH,
  passwordStrength,
  STRENGTH_LEVELS,
} from "@/lib/auth/password-strength";

const BAR_COLORS = ["bg-red-500", "bg-red-500", "bg-amber-500", "bg-brand-600", "bg-brand-700"];

/**
 * Champ mot de passe avec bouton afficher/masquer et, pour un nouveau mot de
 * passe, jauge de robustesse et rappel de la longueur minimale. Jamais soumis
 * tel quel : les formulaires le dérivent dans le navigateur.
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  meter = false,
  error,
  name = "password",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  /** Nouveau mot de passe : jauge et consigne. */
  meter?: boolean;
  error?: string;
  name?: string;
}) {
  const t = useTranslations("auth.passwordField");
  const id = useId();
  const [visible, setVisible] = useState(false);
  const strength = passwordStrength(value);
  const level = STRENGTH_LEVELS.indexOf(strength);
  const describedBy =
    [
      meter ? `${id}-hint` : null,
      meter && value ? `${id}-meter` : null,
      error ? `${id}-error` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} pr-24`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("hideLabel") : t("showLabel")}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 mt-1 rounded-r-lg px-3 text-sm font-medium text-stone-600 hover:text-stone-900"
        >
          {visible ? t("hide") : t("show")}
        </button>
      </div>
      {meter ? (
        <>
          {value ? (
            <div id={`${id}-meter`} className="mt-2" aria-live="polite">
              <div className="flex gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((step) => (
                  <span
                    key={step}
                    className={`h-1.5 flex-1 rounded-full ${level >= step ? BAR_COLORS[level] : "bg-stone-200"}`}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-stone-600">
                {t("strength", { level: t(`levels.${strength}`) })}
              </p>
            </div>
          ) : null}
          <p id={`${id}-hint`} className="mt-1 text-xs text-stone-500">
            {t("hint", { min: MIN_PASSWORD_LENGTH })}
          </p>
        </>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
