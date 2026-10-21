"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { buttonClass } from "@/components/button";
import { ActionForm, inputClass } from "@/components/form";
import { Icon } from "@/components/icons";
import { addFollowedCompany, type FollowFormState } from "./actions";

/** Ajout d'une entreprise : URL de page carrières ou recherche par nom. */
export function FollowForm({ full }: { full: boolean }) {
  const t = useTranslations("followedCompanies");
  const [state, action, pending] = useActionState<FollowFormState, FormData>(
    addFollowedCompany,
    {},
  );
  const errorId = "entreprise-error";

  return (
    <div className="mt-4">
      {/* Sans réinitialisation : la saisie reste en place si elle est refusée. */}
      <ActionForm action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="entreprise" className="text-ink block text-sm font-medium">
            {t("add.label")}
          </label>
          <input
            id="entreprise"
            name="company"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={500}
            placeholder={t("add.placeholder")}
            disabled={full}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? errorId : undefined}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={pending || full}
          className={`${buttonClass("primary")} w-full px-5 sm:w-auto`}
        >
          <Icon name="plus" className="size-4" />
          {pending ? t("add.pending") : t("add.submit")}
        </button>
      </ActionForm>

      {full ? <p className="text-warning-ink mt-3 text-sm">{t("errors.limit")}</p> : null}

      <div aria-live="polite">
        {state.error ? (
          <p
            id={errorId}
            role="alert"
            className="border-danger-line bg-danger-soft text-danger-ink mt-4 rounded-lg border px-4 py-3 text-sm"
          >
            {t(`errors.${state.error}`)}
          </p>
        ) : null}
        {state.added ? (
          <p
            role="status"
            className="border-brand-line bg-brand-soft text-brand-ink mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm font-medium"
          >
            <Icon name="check" className="mt-0.5 size-4 shrink-0" />
            {state.added.alreadyFollowed
              ? t("alreadyFollowed", { name: state.added.name })
              : t("added", { name: state.added.name, count: state.added.openOffers })}
          </p>
        ) : null}
      </div>

      {state.search ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">
            {t("search.title", { query: state.search.query })}
          </h3>
          {state.search.results.length === 0 ? (
            <p className="text-ink-muted mt-2 text-sm">{t("search.empty")}</p>
          ) : (
            <ul className="divide-line border-line mt-2 divide-y rounded-xl border">
              {state.search.results.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{r.name}</span>
                    {r.sector ? (
                      <span className="text-ink-muted text-sm"> · {r.sector}</span>
                    ) : null}
                  </span>
                  {r.followed ? (
                    <span className="text-ink-subtle shrink-0 text-sm">
                      {t("search.following")}
                    </span>
                  ) : (
                    <form action={action} className="shrink-0">
                      <input type="hidden" name="companyId" value={r.id} />
                      <button
                        type="submit"
                        disabled={pending || full}
                        className={buttonClass("secondary", "sm")}
                      >
                        {t("search.follow")}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
