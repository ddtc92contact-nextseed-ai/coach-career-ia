"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { Field, FormError, inputClass } from "@/components/form";
import { Icon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import type { FieldErrors } from "@/lib/career/schemas";
import type { SuggestionData, SuggestionView } from "@/lib/coach/shared";
import { acceptCoachSuggestion, rejectCoachSuggestion } from "../actions";

const acceptClass = buttonClass("approve");
const neutralClass = buttonClass("secondary");
const ghostClass = buttonClass("ghost");

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "");
}

function optionalNumber(form: FormData, name: string): number | undefined {
  const raw = text(form, name).replace(/[\s  ]/g, "");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Carte de suggestion du coach : le candidat l'accepte, la modifie avant de
 * l'accepter, ou la rejette. Rien n'est écrit dans la mémoire avant l'acceptation.
 */
export function SuggestionCard({
  suggestion,
  onChange,
}: {
  suggestion: SuggestionView;
  onChange: (suggestion: SuggestionView) => void;
}) {
  const t = useTranslations("coach.suggestion");
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<FieldErrors | undefined>();
  const [pending, startTransition] = useTransition();
  const decided = suggestion.status !== "PENDING";

  function decide(
    run: () => Promise<
      { ok: true; suggestion: SuggestionView } | { ok: false; errors: FieldErrors }
    >,
  ) {
    setErrors(undefined);
    startTransition(async () => {
      try {
        const result = await run();
        if (result.ok) {
          setEditing(false);
          onChange(result.suggestion);
        } else setErrors(result.errors);
      } catch {
        setErrors({ _form: "invalid" });
      }
    });
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const edited = readEdited(suggestion, new FormData(event.currentTarget));
    decide(() => acceptCoachSuggestion(suggestion.id, edited));
  }

  return (
    <article
      aria-label={t(`kinds.${suggestion.kind}`)}
      className={`overflow-hidden rounded-2xl border sm:ml-12 ${
        decided ? "border-line bg-subtle" : "border-brand-line bg-surface shadow-sm"
      }`}
    >
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-5 ${
          decided ? "border-line" : "band-brand border-brand-line"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${
            decided ? "bg-muted text-ink-muted" : "bg-brand text-on-brand"
          }`}
        >
          <Icon name="spark" className="size-4.5" />
        </span>
        <h3 className="min-w-0 flex-1 font-semibold text-balance">
          {t(`kinds.${suggestion.kind}`)}
        </h3>
        {suggestion.status === "PENDING" ? (
          <Badge tone="warning" icon="clock">
            {t("pendingBadge")}
          </Badge>
        ) : null}
        {suggestion.status === "ACCEPTED" ? (
          <Badge tone="proven" icon="check">
            {t("acceptedBadge")}
          </Badge>
        ) : null}
        {suggestion.status === "REJECTED" ? <Badge>{t("rejectedBadge")}</Badge> : null}
      </div>

      <div className="px-4 py-4 sm:px-5">
        {suggestion.rationale ? (
          <p className="text-ink-muted text-pretty">
            {t("why", { rationale: suggestion.rationale })}
          </p>
        ) : null}
        {suggestion.identityRemoved ? (
          <p className="bg-warning-soft text-warning-ink mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
            <Icon name="shield" className="mt-0.5 size-4 shrink-0" />
            {t("identityRemoved")}
          </p>
        ) : null}

        {editing ? (
          <form onSubmit={submitEdit} noValidate className="mt-4 space-y-4">
            <EditFields suggestion={suggestion} errors={errors} />
            <FormError errors={errors} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending} className={acceptClass}>
                <Icon name="check" className="size-4" />
                {t("saveAccept")}
              </button>
              <button
                type="button"
                disabled={pending}
                className={ghostClass}
                onClick={() => {
                  setEditing(false);
                  setErrors(undefined);
                }}
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="border-line bg-subtle mt-4 rounded-xl border p-3 sm:p-4">
              <SuggestionDetails suggestion={suggestion} />
            </div>
            {errors ? (
              <div className="mt-3">
                <FormError errors={errors} />
              </div>
            ) : null}
            {decided ? (
              <p className="text-ink-muted mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Icon
                  name={suggestion.status === "ACCEPTED" ? "approve" : "deny"}
                  className={`size-5 shrink-0 ${
                    suggestion.status === "ACCEPTED" ? "text-brand-ink" : "text-ink-subtle"
                  }`}
                />
                {suggestion.status === "ACCEPTED" ? (
                  <>
                    {suggestion.kind === "GUARD_RAIL" ? t("acceptedGuardRail") : t("accepted")}{" "}
                    <Link
                      href={suggestion.kind === "GUARD_RAIL" ? "/app/garde-fous" : "/app/memoire"}
                      className="text-brand-ink font-semibold underline underline-offset-4"
                    >
                      {t("view")}
                    </Link>
                  </>
                ) : (
                  t("rejected")
                )}
              </p>
            ) : (
              <>
                <p className="text-ink-subtle mt-4 flex items-center gap-2 text-sm">
                  <Icon name="lock" className="size-4 shrink-0" />
                  {t("draft")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    aria-busy={pending || undefined}
                    className={acceptClass}
                    onClick={() => decide(() => acceptCoachSuggestion(suggestion.id))}
                  >
                    <Icon name="check" className="size-4" />
                    {t("accept")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className={neutralClass}
                    onClick={() => setEditing(true)}
                  >
                    <Icon name="edit" className="size-4" />
                    {t("edit")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className={ghostClass}
                    onClick={() => decide(() => rejectCoachSuggestion(suggestion.id))}
                  >
                    {t("reject")}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-ink-subtle text-sm font-medium">{label}</dt>
      <dd className="break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function SuggestionDetails({ suggestion }: { suggestion: SuggestionView }) {
  const t = useTranslations("coach.suggestion");
  const tc = useTranslations("codes");
  const format = useFormatter();
  const f = useTranslations("coach.suggestion.fields");

  switch (suggestion.kind) {
    case "ACHIEVEMENT": {
      const d = suggestion.data;
      return (
        <dl className="space-y-2">
          <Row label={f("title")}>{d.title}</Row>
          {suggestion.experienceTitle ? (
            <Row label={f("experience")}>{suggestion.experienceTitle}</Row>
          ) : null}
          {d.context ? <Row label={f("context")}>{d.context}</Row> : null}
          <Row label={f("actions")}>{d.actions}</Row>
          {d.result ? <Row label={f("result")}>{d.result}</Row> : null}
          {d.skills.length ? <Row label={f("skills")}>{d.skills.join(", ")}</Row> : null}
          {d.proofUrl ? (
            <Row label={f("proofUrl")}>
              <a
                href={d.proofUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2"
              >
                {d.proofUrl}
              </a>
            </Row>
          ) : null}
        </dl>
      );
    }
    case "EXPERIENCE_UPDATE": {
      const c = suggestion.data.changes;
      return (
        <dl className="space-y-2">
          <Row label={f("experience")}>{suggestion.experienceTitle ?? "—"}</Row>
          {c.roleTitle ? <Row label={f("roleTitle")}>{c.roleTitle}</Row> : null}
          {c.responsibilities ? (
            <Row label={f("responsibilities")}>{c.responsibilities}</Row>
          ) : null}
          {c.seniority ? <Row label={f("seniority")}>{tc(`seniority.${c.seniority}`)}</Row> : null}
          {c.contractType ? (
            <Row label={f("contractType")}>{tc(`contractType.${c.contractType}`)}</Row>
          ) : null}
          {c.sector ? <Row label={f("sector")}>{tc(`sector.${c.sector}`)}</Row> : null}
          {c.companySize ? (
            <Row label={f("companySize")}>{tc(`companySize.${c.companySize}`)}</Row>
          ) : null}
          {c.companyStage ? (
            <Row label={f("companyStage")}>{tc(`companyStage.${c.companyStage}`)}</Row>
          ) : null}
        </dl>
      );
    }
    case "SKILL":
      return (
        <dl>
          <Row label={f("name")}>{suggestion.data.name}</Row>
        </dl>
      );
    case "GUARD_RAIL": {
      const d = suggestion.data;
      const salary = (value: number) => format.number(value, "salary");
      return (
        <dl className="space-y-2">
          {d.minFixedSalary !== undefined ? (
            <Row label={f("minFixedSalary")}>{salary(d.minFixedSalary)}</Row>
          ) : null}
          {d.targetTotalPackage !== undefined ? (
            <Row label={f("targetTotalPackage")}>{salary(d.targetTotalPackage)}</Row>
          ) : null}
          {d.remotePolicy ? (
            <Row label={f("remotePolicy")}>
              {tc(`remotePolicy.${d.remotePolicy}`)}
              {d.minRemoteDays ? ` · ${t("remoteDays", { count: d.minRemoteDays })}` : ""}
            </Row>
          ) : null}
          {d.contractTypes?.length ? (
            <Row label={f("contractTypes")}>
              {d.contractTypes.map((c) => tc(`contractType.${c}`)).join(", ")}
            </Row>
          ) : null}
          {d.excludedSectors?.length ? (
            <Row label={f("excludedSectors")}>
              {d.excludedSectors.map((s) => tc(`sector.${s}`)).join(", ")}
            </Row>
          ) : null}
          {d.maxWeeklyHours !== undefined ? (
            <Row label={f("maxWeeklyHours")}>{d.maxWeeklyHours}</Row>
          ) : null}
          {d.acceptsOnCall !== undefined ? (
            <Row label={f("acceptsOnCall")}>{d.acceptsOnCall ? t("yes") : t("no")}</Row>
          ) : null}
          {d.locations?.length ? (
            <Row label={f("locations")}>
              {d.locations
                .map((l) => t("location", { label: l.label, radius: l.radiusKm }))
                .join(", ")}
            </Row>
          ) : null}
        </dl>
      );
    }
  }
}

function EditFields({ suggestion, errors }: { suggestion: SuggestionView; errors?: FieldErrors }) {
  const t = useTranslations("coach.suggestion");
  const f = useTranslations("coach.suggestion.fields");
  const id = (name: string) => `${suggestion.id}-${name}`;
  const input = (
    name: string,
    label: string,
    value: string | number | undefined,
    props: Record<string, unknown> = {},
  ) => (
    <Field id={id(name)} label={label} error={errors?.[name] ?? errors?.[`changes.${name}`]}>
      <input
        id={id(name)}
        name={name}
        defaultValue={value ?? ""}
        className={inputClass}
        {...props}
      />
    </Field>
  );
  const area = (name: string, label: string, value: string) => (
    <Field id={id(name)} label={label} error={errors?.[name] ?? errors?.[`changes.${name}`]}>
      <textarea id={id(name)} name={name} defaultValue={value} rows={3} className={inputClass} />
    </Field>
  );

  switch (suggestion.kind) {
    case "ACHIEVEMENT": {
      const d = suggestion.data;
      return (
        <>
          {input("title", f("title"), d.title)}
          {area("context", f("context"), d.context)}
          {area("actions", f("actions"), d.actions)}
          {input("result", f("result"), d.result)}
          {input("skills", `${f("skills")} — ${t("skillsHint")}`, d.skills.join(", "))}
          {input("proofUrl", f("proofUrl"), d.proofUrl, { type: "url", inputMode: "url" })}
        </>
      );
    }
    case "EXPERIENCE_UPDATE": {
      const c = suggestion.data.changes;
      return (
        <>
          {c.roleTitle !== undefined ? input("roleTitle", f("roleTitle"), c.roleTitle) : null}
          {c.responsibilities !== undefined
            ? area("responsibilities", f("responsibilities"), c.responsibilities)
            : null}
          {c.roleTitle === undefined && c.responsibilities === undefined ? (
            <p className="text-ink-muted text-sm">{t("nothingToEdit")}</p>
          ) : null}
        </>
      );
    }
    case "SKILL":
      return input("name", f("name"), suggestion.data.name);
    case "GUARD_RAIL": {
      const d = suggestion.data;
      const numeric = { inputMode: "numeric" };
      return (
        <>
          {d.minFixedSalary !== undefined
            ? input("minFixedSalary", f("minFixedSalary"), d.minFixedSalary, numeric)
            : null}
          {d.targetTotalPackage !== undefined
            ? input("targetTotalPackage", f("targetTotalPackage"), d.targetTotalPackage, numeric)
            : null}
          {d.minRemoteDays !== undefined
            ? input("minRemoteDays", f("minRemoteDays"), d.minRemoteDays, numeric)
            : null}
          {d.maxWeeklyHours !== undefined
            ? input("maxWeeklyHours", f("maxWeeklyHours"), d.maxWeeklyHours, numeric)
            : null}
          {[d.minFixedSalary, d.targetTotalPackage, d.minRemoteDays, d.maxWeeklyHours].every(
            (v) => v === undefined,
          ) ? (
            <p className="text-ink-muted text-sm">{t("nothingToEdit")}</p>
          ) : null}
        </>
      );
    }
  }
}

/** Données modifiées par le candidat (revalidées côté serveur). */
function readEdited(
  suggestion: SuggestionView,
  form: FormData,
): SuggestionData[SuggestionView["kind"]] {
  switch (suggestion.kind) {
    case "ACHIEVEMENT":
      return {
        ...suggestion.data,
        title: text(form, "title"),
        context: text(form, "context"),
        actions: text(form, "actions"),
        result: text(form, "result"),
        skills: text(form, "skills")
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        proofUrl: text(form, "proofUrl").trim() || undefined,
      };
    case "EXPERIENCE_UPDATE": {
      const changes = { ...suggestion.data.changes };
      if (form.has("roleTitle")) changes.roleTitle = text(form, "roleTitle");
      if (form.has("responsibilities")) changes.responsibilities = text(form, "responsibilities");
      return { ...suggestion.data, changes };
    }
    case "SKILL":
      return { name: text(form, "name") };
    case "GUARD_RAIL": {
      const data = { ...suggestion.data };
      for (const key of [
        "minFixedSalary",
        "targetTotalPackage",
        "minRemoteDays",
        "maxWeeklyHours",
      ] as const) {
        if (form.has(key)) data[key] = optionalNumber(form, key);
      }
      return data;
    }
  }
}
