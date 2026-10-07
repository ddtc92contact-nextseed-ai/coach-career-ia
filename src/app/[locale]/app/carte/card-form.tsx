"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useActionState, useMemo } from "react";
import { CardIssues } from "@/components/card-issues";
import { ActionForm, Field, inputClass, SubmitButton } from "@/components/form";
import { useVault } from "@/components/vault/vault-provider";
import { checkCard, vaultTerms } from "@/lib/card/reidentify";
import { CARD_LIMITS, type CardContent } from "@/lib/card/schema";
import { approveCardAction, createLinkAction, saveCardAction, type CardFormState } from "./actions";

const secondaryButton =
  "w-full rounded-lg border border-stone-300 px-5 py-2.5 font-medium hover:bg-stone-100 disabled:opacity-60 sm:w-auto";

/** Modification de la carte : textes, éléments affichés, garde-fous montrés. */
export function CardForm({ card }: { card: CardContent }) {
  const t = useTranslations("card.form");
  const tm = useTranslations("matching");
  const tc = useTranslations("codes.evidence");
  const format = useFormatter();
  const [state, action, pending] = useActionState<CardFormState, FormData>(saveCardAction, {});
  const salary =
    card.rails.salaryFloor !== null
      ? format.number(card.rails.salaryFloor, {
          style: "currency",
          currency: "EUR",
          maximumFractionDigits: 0,
        })
      : null;

  return (
    <ActionForm action={action} className="space-y-6">
      {state.message === "invalid" ? (
        <p role="alert" className="text-sm text-red-700">
          {t("invalid")}
        </p>
      ) : null}
      <Field id="headline" label={t("headline")} hint={t("headlineHint")}>
        <input
          id="headline"
          name="headline"
          defaultValue={card.headline}
          maxLength={CARD_LIMITS.headline}
          aria-describedby="headline-hint"
          className={inputClass}
        />
      </Field>

      {card.achievements.length > 0 ? (
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium text-stone-800">{t("achievements")}</legend>
          <p className="text-sm text-stone-500">{t("achievementsHint")}</p>
          {card.achievements.map((a, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-stone-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`achievement-${i}-include`}
                    defaultChecked
                    className="accent-brand-700"
                  />
                  {t("include")}
                </label>
                <span className="text-xs text-stone-500">{tc(a.evidenceLevel)}</span>
              </div>
              <Field id={`achievement-${i}-title`} label={t("achievementTitle")}>
                <input
                  id={`achievement-${i}-title`}
                  name={`achievement-${i}-title`}
                  defaultValue={a.title}
                  maxLength={CARD_LIMITS.achievementTitle}
                  className={inputClass}
                />
              </Field>
              <Field id={`achievement-${i}-result`} label={t("achievementResult")}>
                <textarea
                  id={`achievement-${i}-result`}
                  name={`achievement-${i}-result`}
                  defaultValue={a.result}
                  maxLength={CARD_LIMITS.achievementResult}
                  rows={2}
                  className={inputClass}
                />
              </Field>
            </div>
          ))}
        </fieldset>
      ) : null}

      {card.skills.length > 0 ? (
        <fieldset>
          <legend className="text-sm font-medium text-stone-800">{t("skills")}</legend>
          <p className="text-sm text-stone-500">{t("skillsHint")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {card.skills.map((s, i) => (
              <label
                key={s.name}
                className="flex items-center gap-2 rounded-full border border-stone-200 px-3 py-1 text-sm"
              >
                <input
                  type="checkbox"
                  name={`skill-${i}-include`}
                  defaultChecked
                  className="accent-brand-700"
                />
                {s.name} · {s.proven ? tm("proven") : tm("declared")}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-stone-800">{t("conditions")}</legend>
        {salary ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="showSalary"
              defaultChecked={card.showSalary}
              className="accent-brand-700"
            />
            {t("showSalary", { amount: salary })}
          </label>
        ) : null}
        {card.rails.locations.length > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="showLocations"
              defaultChecked={card.showLocations}
              className="accent-brand-700"
            />
            {t("showLocations")}
          </label>
        ) : null}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="allowProofUrls"
            defaultChecked={card.allowProofUrls}
            aria-describedby="allowProofUrls-hint"
            className="accent-brand-700 mt-1"
          />
          <span>
            {t("allowProofUrls")}
            <span id="allowProofUrls-hint" className="block text-stone-500">
              {t("allowProofUrlsHint")}
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pending={pending}>{t("save")}</SubmitButton>
        {state.message === "saved" && !pending ? (
          <p role="status" className="text-brand-700 text-sm font-medium">
            {t("saved")}
          </p>
        ) : null}
      </div>
    </ActionForm>
  );
}

function useVaultIssues(card: CardContent) {
  const { identity } = useVault();
  // Seuls les termes du coffre sont nouveaux ici : le reste est contrôlé par le serveur.
  return useMemo(
    () =>
      identity
        ? checkCard(card, { terms: vaultTerms(identity) }).filter((i) => i.code === "knownTerm")
        : null,
    [card, identity],
  );
}

/**
 * Validation de la carte : refusée par le serveur tant qu'un problème de
 * ré-identification subsiste, et bloquée ici si le coffre déverrouillé révèle
 * un nom, un employeur ou une école.
 */
export function ApproveCard({ card, disabled }: { card: CardContent; disabled: boolean }) {
  const t = useTranslations("card.form");
  const vaultIssues = useVaultIssues(card);
  const [state, action, pending] = useActionState<CardFormState>(approveCardAction, {});
  return (
    <form action={action} className="space-y-3">
      {state.issues ? <CardIssues issues={state.issues} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending || disabled || (vaultIssues?.length ?? 0) > 0}
          className="bg-brand-700 hover:bg-brand-800 w-full rounded-lg px-5 py-2.5 font-medium text-white disabled:opacity-60 sm:w-auto"
        >
          {t("approve")}
        </button>
        {state.ok && !pending ? (
          <p role="status" className="text-brand-700 text-sm font-medium">
            {t("approved")}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Contrôle complémentaire avec le coffre, entièrement dans le navigateur. */
export function VaultCheck({ card }: { card: CardContent }) {
  const t = useTranslations("card");
  const issues = useVaultIssues(card);
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t("vault.title")}</h2>
      {issues === null ? (
        <p className="mt-2 text-sm text-stone-600">{t("vault.locked")}</p>
      ) : issues.length === 0 ? (
        <p role="status" className="text-brand-700 mt-2 text-sm">
          {t("vault.clean")}
        </p>
      ) : (
        <div className="mt-3">
          <CardIssues issues={issues} title={t("vault.found")} />
        </div>
      )}
    </section>
  );
}

/** Création d'un lien public (affiché une seule fois). */
export function CreateLink() {
  const t = useTranslations("card.links");
  const [state, action, pending] = useActionState<CardFormState>(createLinkAction, {});
  const url =
    state.linkPath && typeof window !== "undefined"
      ? `${window.location.origin}${state.linkPath}`
      : null;
  return (
    <form action={action} className="space-y-3">
      <button type="submit" disabled={pending} className={secondaryButton}>
        {t("create")}
      </button>
      {state.message === "notShareable" ? (
        <p role="alert" className="text-sm text-amber-800">
          {t("notShareable")}
        </p>
      ) : null}
      {url ? (
        <div role="status" className="space-y-1">
          <p className="text-sm text-stone-700">{t("created")}</p>
          <input readOnly value={url} className={inputClass} onFocus={(e) => e.target.select()} />
        </div>
      ) : null}
    </form>
  );
}
