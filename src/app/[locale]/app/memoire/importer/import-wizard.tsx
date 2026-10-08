"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Field, inputClass } from "@/components/form";
import {
  checkImportFile,
  CV_ACCEPT,
  IMPORT_LIMITS,
  isImportErrorCode,
  LINKEDIN_ACCEPT,
  RETRYABLE_IMPORT_ERRORS,
  type ImportErrorCode,
  type ImportResponse,
  type ImportResult,
} from "@/lib/import/shared";
import { ReviewPanel } from "./review";

type Sources = { cv: File | null; linkedin: File | null; github: string };
type Phase =
  | { kind: "form" }
  | { kind: "loading"; started: number }
  | { kind: "error"; code: ImportErrorCode }
  | { kind: "review"; result: ImportResult };

const MB = 1024 * 1024;
const buttonClass =
  "rounded-lg bg-primary px-5 py-2.5 font-medium text-on-primary hover:bg-primary-hover disabled:opacity-60";
const secondaryClass =
  "rounded-lg border border-line-strong bg-surface px-5 py-2.5 font-medium text-ink hover:bg-muted";

/** Appel de l'API d'import ; toute défaillance devient un code traduisible. */
async function requestImport(sources: Sources, signal: AbortSignal): Promise<ImportResponse> {
  const body = new FormData();
  if (sources.cv) body.set("cv", sources.cv);
  if (sources.linkedin) body.set("linkedin", sources.linkedin);
  if (sources.github.trim()) body.set("github", sources.github.trim());
  let response: Response;
  try {
    response = await fetch("/api/import", { method: "POST", body, signal });
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, error: "network" };
  }
  const data = (await response.json().catch(() => null)) as ImportResponse | null;
  if (data && (data.ok || isImportErrorCode(data.error))) return data;
  return { ok: false, error: response.status === 401 ? "unauthorized" : "unknown" };
}

export function ImportWizard({ aiConfigured }: { aiConfigured: boolean }) {
  const t = useTranslations("import");
  const [sources, setSources] = useState<Sources>({ cv: null, linkedin: null, github: "" });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"cv" | "linkedin", ImportErrorCode>>
  >({});
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const controller = useRef<{ abort: AbortController; timedOut: boolean } | null>(null);

  useEffect(() => () => controller.current?.abort.abort(), []);

  const hasSource = Boolean(sources.cv || sources.linkedin || sources.github.trim());

  async function analyse() {
    const current = { abort: new AbortController(), timedOut: false };
    controller.current = current;
    // Jamais d'attente sans fin : le navigateur abandonne après le budget du serveur.
    const timer = setTimeout(() => {
      current.timedOut = true;
      current.abort.abort();
    }, IMPORT_LIMITS.clientTimeoutMs);
    setPhase({ kind: "loading", started: Date.now() });
    try {
      const response = await requestImport(sources, current.abort.signal);
      setPhase(
        response.ok
          ? { kind: "review", result: response.result }
          : { kind: "error", code: response.error },
      );
    } catch {
      setPhase(current.timedOut ? { kind: "error", code: "aiTimeout" } : { kind: "form" });
    } finally {
      clearTimeout(timer);
      if (controller.current === current) controller.current = null;
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const errors = {
      cv: checkImportFile("cv", sources.cv) ?? undefined,
      linkedin: checkImportFile("linkedin", sources.linkedin) ?? undefined,
    };
    setFieldErrors(errors);
    if (errors.cv || errors.linkedin) return;
    if (!hasSource) {
      setPhase({ kind: "error", code: "noSource" });
      return;
    }
    void analyse();
  }

  if (phase.kind === "review") {
    return (
      <ReviewPanel
        result={phase.result}
        onRestart={() => {
          setSources({ cv: null, linkedin: null, github: "" });
          setPhase({ kind: "form" });
        }}
      />
    );
  }

  const errorMessage = (code: ImportErrorCode) =>
    t(`errors.${code}`, {
      cvMaxMb: IMPORT_LIMITS.cvMaxBytes / MB,
      linkedinMaxMb: IMPORT_LIMITS.linkedinMaxBytes / MB,
    });

  // Le formulaire reste monté (masqué) pendant l'analyse : les fichiers choisis restent affichés.
  return (
    <div className="space-y-6">
      {phase.kind === "loading" ? (
        <Progress started={phase.started} onCancel={() => controller.current?.abort.abort()} />
      ) : null}
      <div hidden={phase.kind === "loading"} className="space-y-6">
        <section
          aria-labelledby="privacy-title"
          className="border-brand-line bg-brand-soft text-ink rounded-xl border p-4 text-sm sm:p-5"
        >
          <h2 id="privacy-title" className="font-semibold">
            {t("privacy.title")}
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t("privacy.files")}</li>
            <li>{t("privacy.contacts")}</li>
            <li>{t("privacy.identity")}</li>
            <li>{t("privacy.review")}</li>
          </ul>
        </section>

        {!aiConfigured ? (
          <p
            role="status"
            className="border-warning-line bg-warning-soft text-warning-ink rounded-lg border px-4 py-3 text-sm"
          >
            {t("form.notConfigured")}
          </p>
        ) : null}

        {phase.kind === "error" ? (
          <div
            role="alert"
            className="border-danger-line bg-danger-soft text-danger-ink rounded-lg border px-4 py-3 text-sm"
          >
            <p className="font-semibold">{t("errors.title")}</p>
            <p className="mt-1">{errorMessage(phase.code)}</p>
            {RETRYABLE_IMPORT_ERRORS.includes(phase.code) ? (
              <>
                <p className="mt-1">{t("errors.retryHint")}</p>
                <button
                  type="button"
                  onClick={() => void analyse()}
                  className="bg-danger text-on-danger hover:bg-danger-hover mt-3 rounded-lg px-4 py-2 font-medium"
                >
                  {t("errors.retry")}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <form
          noValidate
          onSubmit={onSubmit}
          className="border-line bg-surface space-y-6 rounded-xl border p-4 sm:p-6"
        >
          <Field
            id="cv"
            label={t("form.cv")}
            hint={t("form.cvHint", { maxMb: IMPORT_LIMITS.cvMaxBytes / MB })}
            optional
          >
            <input
              id="cv"
              name="cv"
              type="file"
              accept={CV_ACCEPT}
              aria-describedby={fieldErrors.cv ? "cv-hint cv-error" : "cv-hint"}
              aria-invalid={fieldErrors.cv ? true : undefined}
              onChange={(event) => {
                setSources((s) => ({ ...s, cv: event.target.files?.[0] ?? null }));
                setFieldErrors((e) => ({ ...e, cv: undefined }));
              }}
              className={`${inputClass} file:bg-muted file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5`}
            />
            {fieldErrors.cv ? (
              <p id="cv-error" role="alert" className="text-danger-ink mt-1.5 text-sm">
                {errorMessage(fieldErrors.cv)}
              </p>
            ) : null}
          </Field>

          <Field
            id="linkedin"
            label={t("form.linkedin")}
            hint={t("form.linkedinHint", { maxMb: IMPORT_LIMITS.linkedinMaxBytes / MB })}
            optional
          >
            <input
              id="linkedin"
              name="linkedin"
              type="file"
              accept={LINKEDIN_ACCEPT}
              aria-describedby={
                fieldErrors.linkedin ? "linkedin-hint linkedin-error" : "linkedin-hint"
              }
              aria-invalid={fieldErrors.linkedin ? true : undefined}
              onChange={(event) => {
                setSources((s) => ({ ...s, linkedin: event.target.files?.[0] ?? null }));
                setFieldErrors((e) => ({ ...e, linkedin: undefined }));
              }}
              className={`${inputClass} file:bg-muted file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5`}
            />
            {fieldErrors.linkedin ? (
              <p id="linkedin-error" role="alert" className="text-danger-ink mt-1.5 text-sm">
                {errorMessage(fieldErrors.linkedin)}
              </p>
            ) : null}
          </Field>

          <Field id="github" label={t("form.github")} hint={t("form.githubHint")} optional>
            <input
              id="github"
              name="github"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              value={sources.github}
              placeholder={t("form.githubPlaceholder")}
              aria-describedby="github-hint"
              onChange={(event) => setSources((s) => ({ ...s, github: event.target.value }))}
              className={inputClass}
            />
          </Field>

          <button
            type="submit"
            disabled={!aiConfigured}
            className={`w-full sm:w-auto ${buttonClass}`}
          >
            {t("form.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}

const STEPS = ["reading", "analysing", "drafting"] as const;

function Progress({ started, onCancel }: { started: number; onCancel: () => void }) {
  const t = useTranslations("import.progress");
  const [now, setNow] = useState(started);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  // Étapes indicatives : le serveur ne diffuse pas d'avancement.
  const step = seconds < 4 ? 0 : seconds < 45 ? 1 : 2;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-line bg-surface rounded-xl border p-6 text-center sm:p-10"
    >
      <div
        aria-hidden="true"
        className="border-t-brand-600 border-line mx-auto h-10 w-10 animate-spin rounded-full border-4"
      />
      <p className="mt-4 font-semibold">{t("label")}</p>
      <ol className="mx-auto mt-4 max-w-xs space-y-1 text-left text-sm">
        {STEPS.map((key, index) => (
          <li
            key={key}
            aria-current={index === step ? "step" : undefined}
            className={
              index < step
                ? "text-ink-subtle line-through"
                : index === step
                  ? "text-ink font-medium"
                  : "text-ink-subtle"
            }
          >
            {t(key)}
          </li>
        ))}
      </ol>
      <p className="text-ink-subtle mt-4 text-sm">{t("elapsed", { seconds })}</p>
      {seconds >= 60 ? <p className="text-warning-ink mt-1 text-sm">{t("slow")}</p> : null}
      <button type="button" onClick={onCancel} className={`mt-6 ${secondaryClass}`}>
        {t("cancel")}
      </button>
    </div>
  );
}
