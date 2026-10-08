"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useActionState, useMemo } from "react";
import { Card, CardHeader } from "@/components/card";
import { CardIssues } from "@/components/card-issues";
import { buttonClass } from "@/components/button";
import { EvidenceBadge } from "@/components/evidence-badge";
import { ActionForm, Field, inputClass, SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import { useVault } from "@/components/vault/vault-provider";
import { checkCard, vaultTerms } from "@/lib/card/reidentify";
import { CARD_LIMITS, type CardContent } from "@/lib/card/schema";
import { approveCardAction, createLinkAction, saveCardAction, type CardFormState } from "./actions";

/** Modification de la carte : textes, éléments affichés, garde-fous montrés. */
export function CardForm({ card }: { card: CardContent }) {
  const t = useTranslations("card.form");
  const tm = useTranslations("matching");
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
        <p role="alert" className="text-danger-ink text-sm">
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
          <legend className="text-ink text-sm font-medium">{t("achievements")}</legend>
          <p className="text-ink-subtle text-sm">{t("achievementsHint")}</p>
          {card.achievements.map((a, i) => (
            <div key={i} className="border-line bg-subtle space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    name={`achievement-${i}-include`}
                    defaultChecked
                    className="accent-brand size-4"
                  />
                  {t("include")}
                </label>
                <EvidenceBadge level={a.evidenceLevel} />
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
          <legend className="text-ink text-sm font-medium">{t("skills")}</legend>
          <p className="text-ink-subtle text-sm">{t("skillsHint")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {card.skills.map((s, i) => (
              <label
                key={s.name}
                className="border-line-strong bg-surface has-[:checked]:border-brand-line has-[:checked]:bg-brand-soft flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  name={`skill-${i}-include`}
                  defaultChecked
                  className="accent-brand"
                />
                {s.name} · {s.proven ? tm("proven") : tm("declared")}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="border-line space-y-2 border-t pt-5">
        <legend className="text-ink text-sm font-medium">{t("conditions")}</legend>
        {salary ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              name="showSalary"
              defaultChecked={card.showSalary}
              className="accent-brand"
            />
            {t("showSalary", { amount: salary })}
          </label>
        ) : null}
        {card.rails.locations.length > 0 ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              name="showLocations"
              defaultChecked={card.showLocations}
              className="accent-brand"
            />
            {t("showLocations")}
          </label>
        ) : null}
        <label className="flex cursor-pointer items-start gap-2 py-2">
          <input
            type="checkbox"
            name="allowProofUrls"
            defaultChecked={card.allowProofUrls}
            aria-describedby="allowProofUrls-hint"
            className="accent-brand mt-1"
          />
          <span>
            {t("allowProofUrls")}
            <span id="allowProofUrls-hint" className="text-ink-muted block text-sm">
              {t("allowProofUrlsHint")}
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pending={pending}>{t("save")}</SubmitButton>
        {state.message === "saved" && !pending ? (
          <p role="status" className="text-brand-ink text-sm font-medium">
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
          className="bg-brand hover:bg-brand-hover text-on-brand inline-flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3.5 font-semibold shadow-sm disabled:opacity-60 sm:w-auto"
        >
          <Icon name="approve" className="size-5" />
          {t("approve")}
        </button>
        {state.ok && !pending ? (
          <p role="status" className="text-brand-ink text-sm font-medium">
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
    <Card aria-labelledby="verification-coffre">
      <CardHeader
        id="verification-coffre"
        icon={issues === null ? "lock" : "unlock"}
        title={t("vault.title")}
      />
      {issues === null ? (
        <p className="text-ink-muted mt-4">{t("vault.locked")}</p>
      ) : issues.length === 0 ? (
        <p role="status" className="text-brand-ink mt-4 flex items-center gap-2 font-medium">
          <Icon name="shield" className="size-5 shrink-0" />
          {t("vault.clean")}
        </p>
      ) : (
        <div className="mt-4">
          <CardIssues issues={issues} title={t("vault.found")} />
        </div>
      )}
    </Card>
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
      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass("secondary")} w-full sm:w-auto`}
      >
        <Icon name="link" className="size-4" />
        {t("create")}
      </button>
      {state.message === "notShareable" ? (
        <p role="alert" className="text-warning-ink text-sm">
          {t("notShareable")}
        </p>
      ) : null}
      {url ? (
        <div role="status" className="space-y-1">
          <p className="text-ink-muted text-sm">{t("created")}</p>
          <input readOnly value={url} className={inputClass} onFocus={(e) => e.target.select()} />
        </div>
      ) : null}
    </form>
  );
}
