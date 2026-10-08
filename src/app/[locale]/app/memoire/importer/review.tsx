"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/badge";
import { Field, fieldProps, FormError, inputClass } from "@/components/form";
import { Link } from "@/i18n/navigation";
import type { ImportedDraftSummary } from "@/lib/career/repository";
import {
  COMPANY_SIZES,
  COMPANY_STAGES,
  CONTRACT_TYPES,
  SECTORS,
  SENIORITIES,
} from "@/lib/career/codes";
import {
  CareerMemoryDraft,
  currentMonth,
  LIMITS,
  toFieldErrors,
  type FieldErrors,
} from "@/lib/career/schemas";
import type { ImportResult, ItemFlags } from "@/lib/import/shared";
import { saveImport } from "./actions";

type DraftExperience = CareerMemoryDraft["experiences"][number];
type DraftAchievement = CareerMemoryDraft["achievements"][number];
type Decision = "pending" | "accepted" | "rejected";
type Item<T> = { data: T; flags: ItemFlags; decision: Decision; edited: boolean; editing: boolean };

const experienceSchema = CareerMemoryDraft.shape.experiences.element;
const achievementSchema = CareerMemoryDraft.shape.achievements.element;

const smallButton =
  "rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 aria-pressed:ring-2";
const acceptClass = `${smallButton} border-brand text-brand-ink hover:bg-brand-soft aria-pressed:bg-brand aria-pressed:text-on-brand aria-pressed:ring-brand-line`;
const rejectClass = `${smallButton} border-line-strong text-ink-muted hover:bg-muted aria-pressed:bg-primary-hover aria-pressed:text-on-primary aria-pressed:ring-line-strong`;
const neutralClass = `${smallButton} border-line-strong bg-surface text-ink-muted hover:bg-muted`;

function toItems<T>(data: T[], flags: ItemFlags[]): Item<T>[] {
  return data.map((value, index) => ({
    data: value,
    flags: flags[index] ?? {
      identityRemoved: false,
      identifyingLink: false,
      adjusted: false,
      rareDetails: [],
    },
    decision: "pending",
    edited: false,
    editing: false,
  }));
}

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "");
}

export function ReviewPanel({
  result,
  onRestart,
}: {
  result: ImportResult;
  onRestart: () => void;
}) {
  const t = useTranslations("import.review");
  const [experiences, setExperiences] = useState(() =>
    toItems(result.draft.experiences, result.flags.experiences),
  );
  const [achievements, setAchievements] = useState(() =>
    toItems(result.draft.achievements, result.flags.achievements),
  );
  const [skills, setSkills] = useState(() =>
    result.draft.skills.map((name) => ({ name, accepted: false })),
  );
  const [saveErrors, setSaveErrors] = useState<FieldErrors | undefined>();
  const [saved, setSaved] = useState<ImportedDraftSummary | null>(null);
  const [pending, startTransition] = useTransition();

  const acceptedExperienceRefs = new Set(
    experiences.filter((e) => e.decision === "accepted").map((e) => e.data.ref),
  );
  const acceptedCount =
    acceptedExperienceRefs.size +
    achievements.filter((a) => a.decision === "accepted").length +
    skills.filter((s) => s.accepted).length;

  function setAll(decision: Decision) {
    const apply = <T,>(items: Item<T>[]) =>
      items.map((item) => ({ ...item, decision, editing: false }));
    setExperiences(apply);
    setAchievements(apply);
    setSkills((list) => list.map((s) => ({ ...s, accepted: decision === "accepted" })));
  }

  function save() {
    // Seuls les éléments acceptés partent au serveur ; une réalisation dont
    // l'expérience est rejetée est enregistrée sans lien.
    const draft: CareerMemoryDraft = {
      experiences: experiences.filter((e) => e.decision === "accepted").map((e) => e.data),
      achievements: achievements
        .filter((a) => a.decision === "accepted")
        .map((a) => ({
          ...a.data,
          experienceRef:
            a.data.experienceRef && acceptedExperienceRefs.has(a.data.experienceRef)
              ? a.data.experienceRef
              : undefined,
        })),
      skills: skills.filter((s) => s.accepted).map((s) => s.name),
    };
    setSaveErrors(undefined);
    startTransition(async () => {
      try {
        const response = await saveImport(draft);
        if (response.ok) setSaved(response.summary);
        else setSaveErrors(response.errors);
      } catch {
        setSaveErrors({ _form: "invalid" });
      }
    });
  }

  if (saved) return <Done summary={saved} onRestart={onRestart} />;

  const experienceOptions = experiences
    .filter((e) => e.decision !== "rejected")
    .map((e) => ({ ref: e.data.ref, label: e.data.roleTitle }));
  const roleByRef = new Map(experiences.map((e) => [e.data.ref, e]));

  return (
    <div className="space-y-10 pb-28">
      <div className="border-line bg-surface rounded-xl border p-4 sm:p-5">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-ink-muted mt-1 text-sm">{t("intro")}</p>
        <p className="text-ink-muted mt-2 text-sm">
          {t("found", {
            experiences: experiences.length,
            achievements: achievements.length,
            skills: skills.length,
          })}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={neutralClass} onClick={() => setAll("accepted")}>
            {t("acceptAll")}
          </button>
          <button type="button" className={neutralClass} onClick={() => setAll("rejected")}>
            {t("rejectAll")}
          </button>
        </div>
      </div>

      <IdentityPanel identity={result.identity} experiences={experiences.map((e) => e.data)} />

      <Section id="import-experiences" title={t("experiencesTitle")} empty={!experiences.length}>
        {experiences.map((item, index) => (
          <ExperienceCard
            key={item.data.ref}
            item={item}
            onChange={(next) =>
              setExperiences((list) => list.map((e, i) => (i === index ? next : e)))
            }
          />
        ))}
      </Section>

      <Section id="import-achievements" title={t("achievementsTitle")} empty={!achievements.length}>
        {achievements.map((item, index) => (
          <AchievementCard
            key={index}
            index={index}
            item={item}
            linkedRole={
              item.data.experienceRef ? roleByRef.get(item.data.experienceRef) : undefined
            }
            experienceOptions={experienceOptions}
            onChange={(next) =>
              setAchievements((list) => list.map((a, i) => (i === index ? next : a)))
            }
          />
        ))}
      </Section>

      <Section id="import-skills" title={t("skillsTitle")} empty={!skills.length}>
        <p className="text-ink-muted text-sm">{t("skillsIntro")}</p>
        <ul className="flex flex-wrap gap-2">
          {skills.map((skill, index) => (
            <li key={skill.name}>
              <button
                type="button"
                aria-pressed={skill.accepted}
                onClick={() =>
                  setSkills((list) =>
                    list.map((s, i) => (i === index ? { ...s, accepted: !s.accepted } : s)),
                  )
                }
                className={`rounded-full border px-3 py-1 text-sm ${
                  skill.accepted
                    ? "border-brand bg-brand text-on-brand"
                    : "border-line-strong bg-surface text-ink-muted hover:bg-muted"
                }`}
              >
                {skill.accepted ? "✓ " : "+ "}
                {skill.name}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <div className="border-line bg-surface/95 fixed inset-x-0 bottom-0 z-10 border-t px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            {saveErrors ? (
              <FormError errors={saveErrors._form ? saveErrors : { _form: "invalid" }} />
            ) : (
              <span className="text-ink-muted">{t("saveHint")}</span>
            )}
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={onRestart} className={neutralClass}>
              {t("restart")}
            </button>
            <button
              type="button"
              disabled={acceptedCount === 0 || pending}
              onClick={save}
              className="bg-primary text-on-primary hover:bg-primary-hover rounded-lg px-5 py-2.5 font-medium disabled:opacity-60"
            >
              {pending ? t("saving") : t("save", { count: acceptedCount })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  empty,
  children,
}: {
  id: string;
  title: string;
  empty: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("import.review");
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {empty ? <p className="text-ink-subtle text-sm">{t("empty")}</p> : children}
    </section>
  );
}

function DecisionBar<T>({ item, onChange }: { item: Item<T>; onChange: (next: Item<T>) => void }) {
  const t = useTranslations("import.review");
  const status =
    item.decision === "accepted" ? (item.edited ? "edited" : "accepted") : item.decision;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Badge
        tone={
          item.decision === "accepted"
            ? "proven"
            : item.decision === "rejected"
              ? "neutral"
              : "warning"
        }
      >
        {t(`status.${status}`)}
      </Badge>
      <span className="grow" />
      <button
        type="button"
        aria-pressed={item.decision === "accepted"}
        className={acceptClass}
        onClick={() =>
          onChange({
            ...item,
            editing: false,
            decision: item.decision === "accepted" ? "pending" : "accepted",
          })
        }
      >
        {t("accept")}
      </button>
      <button
        type="button"
        aria-expanded={item.editing}
        className={neutralClass}
        onClick={() => onChange({ ...item, editing: !item.editing })}
      >
        {t("edit")}
      </button>
      <button
        type="button"
        aria-pressed={item.decision === "rejected"}
        className={rejectClass}
        onClick={() =>
          onChange({
            ...item,
            editing: false,
            decision: item.decision === "rejected" ? "pending" : "rejected",
          })
        }
      >
        {t("reject")}
      </button>
    </div>
  );
}

function FlagNotes({ flags }: { flags: ItemFlags }) {
  const t = useTranslations("import.review.flags");
  const notes: ReactNode[] = [];
  if (flags.identityRemoved) notes.push(t("identityRemoved"));
  if (flags.identifyingLink) notes.push(t("identifyingLink"));
  if (flags.adjusted) notes.push(t("adjusted"));
  for (const detail of flags.rareDetails) {
    notes.push(
      <>
        <span className="font-medium">{t("rareDetail")}</span> {detail}
      </>,
    );
  }
  if (!notes.length) return null;
  return (
    <ul className="bg-warning-soft text-warning-ink mt-3 space-y-1 rounded-lg px-3 py-2 text-sm">
      {notes.map((note, index) => (
        <li key={index}>⚠ {note}</li>
      ))}
    </ul>
  );
}

function useMonthLabel() {
  const format = useFormatter();
  return (month: string) =>
    format.dateTime(new Date(`${month}-01T00:00:00Z`), {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    });
}

// --- Expériences ----------------------------------------------------------------------

function ExperienceCard({
  item,
  onChange,
}: {
  item: Item<DraftExperience>;
  onChange: (next: Item<DraftExperience>) => void;
}) {
  const tm = useTranslations("memory");
  const tc = useTranslations("codes");
  const month = useMonthLabel();
  const { data } = item;
  return (
    <article
      aria-label={data.roleTitle}
      className={`bg-surface rounded-xl border p-4 sm:p-5 ${item.decision === "rejected" ? "border-line opacity-60" : "border-line"}`}
    >
      <h3 className="font-semibold break-words">{data.roleTitle}</h3>
      <p className="text-ink-subtle mt-0.5 text-sm">
        {tm("period", {
          start: month(data.startMonth),
          end: data.endMonth ? month(data.endMonth) : tm("present"),
        })}
      </p>
      <p className="text-ink-muted mt-2 text-sm">
        {[
          tc(`companyStage.${data.companyStage}`),
          tc(`sector.${data.sector}`),
          tc(`companySize.${data.companySize}`),
        ].join(" · ")}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge>{tc(`seniority.${data.seniority}`)}</Badge>
        <Badge>{tc(`contractType.${data.contractType}`)}</Badge>
      </div>
      {data.responsibilities ? (
        <p className="text-ink-muted mt-2 text-sm whitespace-pre-line">{data.responsibilities}</p>
      ) : null}
      <FlagNotes flags={item.flags} />
      <DecisionBar item={item} onChange={onChange} />
      {item.editing ? (
        <ExperienceEditor
          data={data}
          onCancel={() => onChange({ ...item, editing: false })}
          onSave={(next) =>
            onChange({ ...item, data: next, edited: true, editing: false, decision: "accepted" })
          }
        />
      ) : null}
    </article>
  );
}

function ExperienceEditor({
  data,
  onSave,
  onCancel,
}: {
  data: DraftExperience;
  onSave: (next: DraftExperience) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("memory.experiences.form");
  const tc = useTranslations("codes");
  const tr = useTranslations("import.review");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [current, setCurrent] = useState(!data.endMonth);
  const p = `exp-${data.ref}`;
  const field = (name: string) => ({ ...fieldProps(`${p}-${name}`, errors[name]), name });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = experienceSchema.safeParse({
      ref: data.ref,
      roleTitle: text(form, "roleTitle"),
      startMonth: text(form, "startMonth"),
      endMonth: current ? "" : text(form, "endMonth"),
      seniority: text(form, "seniority"),
      contractType: text(form, "contractType"),
      sector: text(form, "sector"),
      companySize: text(form, "companySize"),
      companyStage: text(form, "companyStage"),
      responsibilities: text(form, "responsibilities"),
    });
    if (!parsed.success) return setErrors(toFieldErrors(parsed.error));
    onSave(parsed.data);
  }

  const select = (name: string, codes: readonly string[], family: string, value: string) => (
    <Field id={`${p}-${name}`} label={t(name as "sector")} error={errors[name]}>
      <select {...field(name)} defaultValue={value} className={inputClass}>
        {codes.map((code) => (
          <option key={code} value={code}>
            {tc(`${family}.${code}` as "sector.OTHER")}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <form noValidate onSubmit={submit} className="border-line mt-4 space-y-4 border-t pt-4">
      <FormError errors={Object.keys(errors).length ? errors : undefined} />
      <Field id={`${p}-roleTitle`} label={t("roleTitle")} error={errors.roleTitle}>
        <input
          {...field("roleTitle")}
          defaultValue={data.roleTitle}
          maxLength={LIMITS.roleTitle}
          className={inputClass}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${p}-startMonth`} label={t("startMonth")} error={errors.startMonth}>
          <input
            {...field("startMonth")}
            type="month"
            max={currentMonth()}
            defaultValue={data.startMonth}
            className={inputClass}
          />
        </Field>
        <div>
          <Field id={`${p}-endMonth`} label={t("endMonth")} error={errors.endMonth}>
            <input
              {...field("endMonth")}
              type="month"
              max={currentMonth()}
              disabled={current}
              defaultValue={data.endMonth ?? ""}
              className={inputClass}
            />
          </Field>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={current}
              onChange={(e) => setCurrent(e.target.checked)}
            />
            {t("current")}
          </label>
        </div>
        {select("seniority", SENIORITIES, "seniority", data.seniority)}
        {select("contractType", CONTRACT_TYPES, "contractType", data.contractType)}
        {select("sector", SECTORS, "sector", data.sector)}
        {select("companySize", COMPANY_SIZES, "companySize", data.companySize)}
        {select("companyStage", COMPANY_STAGES, "companyStage", data.companyStage)}
      </div>
      <Field
        id={`${p}-responsibilities`}
        label={t("responsibilities")}
        hint={t("responsibilitiesHint")}
        error={errors.responsibilities}
        optional
      >
        <textarea
          {...field("responsibilities")}
          rows={3}
          maxLength={LIMITS.responsibilities}
          defaultValue={data.responsibilities}
          className={inputClass}
        />
      </Field>
      <EditorButtons onCancel={onCancel} label={tr("applyEdit")} />
    </form>
  );
}

function EditorButtons({ onCancel, label }: { onCancel: () => void; label: string }) {
  const tm = useTranslations("memory");
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row">
      <button type="button" onClick={onCancel} className={neutralClass}>
        {tm("cancel")}
      </button>
      <button
        type="submit"
        className="bg-primary text-on-primary hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-medium"
      >
        {label}
      </button>
    </div>
  );
}

// --- Réalisations ---------------------------------------------------------------------

function AchievementCard({
  index,
  item,
  linkedRole,
  experienceOptions,
  onChange,
}: {
  index: number;
  item: Item<DraftAchievement>;
  linkedRole?: Item<DraftExperience>;
  experienceOptions: { ref: string; label: string }[];
  onChange: (next: Item<DraftAchievement>) => void;
}) {
  const t = useTranslations("import.review");
  const tf = useTranslations("memory.achievements.form");
  const tc = useTranslations("codes");
  const { data } = item;
  const evidence = data.proofs.length > 0 ? "DOCUMENT" : "DECLARED";

  return (
    <article
      aria-label={data.title}
      className={`border-line bg-surface rounded-xl border p-4 sm:p-5 ${item.decision === "rejected" ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 font-semibold break-words">{data.title}</h3>
        <Badge tone={evidence === "DOCUMENT" ? "proven" : "warning"}>
          {tc(`evidence.${evidence}`)}
        </Badge>
      </div>
      {linkedRole ? (
        <p className="text-ink-subtle mt-0.5 text-sm">
          {t("linkedTo", { role: linkedRole.data.roleTitle })}
          {linkedRole.decision === "rejected" ? (
            <span className="text-warning-ink block">{t("linkedRejected")}</span>
          ) : null}
        </p>
      ) : null}
      <dl className="mt-3 space-y-2 text-sm">
        {(["context", "actions", "result"] as const).map((key) =>
          data[key] ? (
            <div key={key}>
              <dt className="text-ink font-medium">{tf(key)}</dt>
              <dd className="text-ink-muted whitespace-pre-line">{data[key]}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {data.skills.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.skills.map((skill) => (
            <Badge key={skill}>{skill}</Badge>
          ))}
        </div>
      ) : null}
      {data.proofs.length ? (
        <div className="mt-3 text-sm">
          <p className="text-ink font-medium">{t("proofs")}</p>
          <ul className="mt-1 space-y-1">
            {data.proofs.map((proof, proofIndex) => (
              <li key={proofIndex} className="flex items-center justify-between gap-2">
                <span className="text-ink-muted min-w-0 truncate">
                  {proof.kind === "URL" ? proof.url : proof.referenceText}
                </span>
                <button
                  type="button"
                  className="text-danger-ink shrink-0 text-sm underline underline-offset-4"
                  onClick={() =>
                    onChange({
                      ...item,
                      edited: true,
                      data: { ...data, proofs: data.proofs.filter((_, i) => i !== proofIndex) },
                    })
                  }
                >
                  {t("removeProof")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <FlagNotes flags={item.flags} />
      <DecisionBar item={item} onChange={onChange} />
      {item.editing ? (
        <AchievementEditor
          index={index}
          data={data}
          experienceOptions={experienceOptions}
          onCancel={() => onChange({ ...item, editing: false })}
          onSave={(next) =>
            onChange({ ...item, data: next, edited: true, editing: false, decision: "accepted" })
          }
        />
      ) : null}
    </article>
  );
}

function AchievementEditor({
  index,
  data,
  experienceOptions,
  onSave,
  onCancel,
}: {
  index: number;
  data: DraftAchievement;
  experienceOptions: { ref: string; label: string }[];
  onSave: (next: DraftAchievement) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("memory.achievements.form");
  const tr = useTranslations("import.review");
  const [errors, setErrors] = useState<FieldErrors>({});
  const p = `ach-${index}`;
  const field = (name: string) => ({ ...fieldProps(`${p}-${name}`, errors[name]), name });
  const skillsError =
    errors.skills ?? Object.entries(errors).find(([key]) => key.startsWith("skills."))?.[1];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = achievementSchema.safeParse({
      title: text(form, "title"),
      context: text(form, "context"),
      actions: text(form, "actions"),
      result: text(form, "result"),
      skills: text(form, "skills"),
      experienceRef: text(form, "experienceRef") || undefined,
      proofs: data.proofs,
    });
    if (!parsed.success) return setErrors(toFieldErrors(parsed.error));
    onSave(parsed.data);
  }

  return (
    <form noValidate onSubmit={submit} className="border-line mt-4 space-y-4 border-t pt-4">
      <FormError errors={Object.keys(errors).length ? errors : undefined} />
      <Field id={`${p}-title`} label={t("title")} error={errors.title}>
        <input
          {...field("title")}
          defaultValue={data.title}
          maxLength={LIMITS.achievementTitle}
          className={inputClass}
        />
      </Field>
      <Field id={`${p}-experienceRef`} label={t("experience")} optional>
        <select
          {...field("experienceRef")}
          defaultValue={data.experienceRef ?? ""}
          className={inputClass}
        >
          <option value="">{t("noExperience")}</option>
          {experienceOptions.map((option) => (
            <option key={option.ref} value={option.ref}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      {(
        [
          ["context", LIMITS.context, 2, true],
          ["actions", LIMITS.actions, 3, false],
          ["result", LIMITS.result, 2, true],
        ] as const
      ).map(([name, max, rows, optional]) => (
        <Field
          key={name}
          id={`${p}-${name}`}
          label={t(name)}
          error={errors[name]}
          optional={optional}
        >
          <textarea
            {...field(name)}
            rows={rows}
            maxLength={max}
            defaultValue={data[name]}
            className={inputClass}
          />
        </Field>
      ))}
      <Field
        id={`${p}-skills`}
        label={t("skills")}
        hint={t("skillsHint")}
        error={skillsError}
        optional
      >
        <input
          {...fieldProps(`${p}-skills`, skillsError, "hint")}
          name="skills"
          defaultValue={data.skills.join(", ")}
          className={inputClass}
        />
      </Field>
      <EditorButtons onCancel={onCancel} label={tr("applyEdit")} />
    </form>
  );
}

// --- Identité et fin ------------------------------------------------------------------

function IdentityPanel({
  identity,
  experiences,
}: {
  identity: ImportResult["identity"];
  experiences: DraftExperience[];
}) {
  const t = useTranslations("import.review.identity");
  const roleByRef = new Map(experiences.map((e) => [e.ref, e.roleTitle]));
  const rows: [string, string[]][] = [
    ["fullName", identity.fullName ? [identity.fullName] : []],
    ["emails", identity.emails],
    ["phones", identity.phones],
    ["links", identity.links],
    [
      "employers",
      identity.employers.map((e) => {
        const role = e.experienceRef ? roleByRef.get(e.experienceRef) : undefined;
        return role ? `${e.name} (${role})` : e.name;
      }),
    ],
    ["schools", identity.schools.map((s) => (s.degree ? `${s.name} (${s.degree})` : s.name))],
    ["organizations", identity.organizations],
  ];
  const filled = rows.filter(([, values]) => values.length);
  if (!filled.length) return null;
  return (
    <details className="border-line bg-subtle rounded-xl border p-4 sm:p-5">
      <summary className="cursor-pointer font-semibold">{t("title")}</summary>
      <p className="text-ink-muted mt-2 text-sm">{t("intro")}</p>
      <p className="text-ink-muted mt-1 text-sm">{t("vault")}</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[12rem_1fr]">
        {filled.map(([key, values]) => (
          <div key={key} className="contents">
            <dt className="text-ink font-medium">{t(key as "emails")}</dt>
            <dd className="text-ink-muted min-w-0 break-words">{values.join(" · ")}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Done({ summary, onRestart }: { summary: ImportedDraftSummary; onRestart: () => void }) {
  const t = useTranslations("import.done");
  return (
    <div role="status" className="border-line bg-surface rounded-xl border p-6 sm:p-8">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="text-ink-muted mt-2">
        {t("text", {
          experiences: summary.experiences,
          achievements: summary.achievements,
          skills: summary.skills,
        })}
      </p>
      <p className="text-ink-muted mt-2 text-sm">{t("next")}</p>
      <p className="text-ink-muted mt-1 text-sm">{t("identityForgotten")}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/app/memoire"
          className="bg-primary text-on-primary hover:bg-primary-hover rounded-lg px-5 py-2.5 text-center font-medium"
        >
          {t("cta")}
        </Link>
        <button type="button" onClick={onRestart} className={neutralClass}>
          {t("again")}
        </button>
      </div>
    </div>
  );
}
