"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  COACH_LIMITS,
  isCoachErrorCode,
  type CoachErrorCode,
  type CoachMessageView,
  type CoachModeCode,
  type CoachStreamEvent,
  type SuggestionView,
} from "@/lib/coach/shared";
import { CoachUpsell } from "../upsell";
import { SuggestionCard } from "./suggestion-card";

type Pending = {
  status: "thinking" | "reading" | "suggesting";
  text: string;
  suggestions: SuggestionView[];
};

type SendBody = { content: string } | { retry: true };

const buttonClass =
  "rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50";

/** Lit un flux NDJSON ligne par ligne. */
async function* readEvents(response: Response): AsyncGenerator<CoachStreamEvent> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as CoachStreamEvent;
      } catch {
        // Ligne illisible : ignorée, l'absence de `done` sera signalée.
      }
    }
  }
}

export function CoachChat({
  conversationId,
  mode,
  initialMessages,
  initialRemaining,
  limit,
  configured,
  billing,
}: {
  conversationId: string;
  mode: CoachModeCode;
  initialMessages: CoachMessageView[];
  /** `null` : illimité (Premium). */
  initialRemaining: number | null;
  limit: number | null;
  configured: boolean;
  /** Paiement disponible : la limite atteinte propose Premium. */
  billing: boolean;
}) {
  const t = useTranslations("coach");
  const [messages, setMessages] = useState(initialMessages);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<CoachErrorCode | null>(null);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [input, setInput] = useState("");
  const controller = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [messages.length, pending?.text, pending?.suggestions.length, error]);

  const busy = pending !== null;
  const last = messages.at(-1);
  // Dernier message sans réponse (panne, onglet fermé) : on propose de relancer.
  const canRetry = !busy && last?.role === "USER" && !String(last.id).startsWith("local-");
  const tooLong = input.length > COACH_LIMITS.messageMaxChars;
  const exhausted = remaining === 0;
  const canSend = configured && !busy && input.trim().length > 0 && !tooLong && !exhausted;

  async function run(body: SendBody) {
    const abort = new AbortController();
    controller.current = abort;
    let timedOut = false;
    // Jamais d'attente sans fin : le navigateur abandonne après le budget du serveur.
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, COACH_LIMITS.clientTimeoutMs);
    const localId = `local-${Date.now()}`;
    if ("content" in body) {
      setMessages((list) => [
        ...list,
        {
          id: localId,
          role: "USER",
          content: body.content,
          createdAt: new Date().toISOString(),
          suggestions: [],
        },
      ]);
    }
    setError(null);
    setPending({ status: "thinking", text: "", suggestions: [] });

    let accepted = "retry" in body;
    let finished = false;
    const failBeforeAcceptance = (code: CoachErrorCode) => {
      // Message non enregistré : il revient dans la zone de saisie.
      if ("content" in body) {
        setMessages((list) => list.filter((m) => m.id !== localId));
        setInput(body.content);
      }
      setError(code);
    };

    try {
      const response = await fetch(`/api/coach/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
        const code = isCoachErrorCode(data?.error)
          ? data.error
          : response.status === 401
            ? "unauthorized"
            : "unknown";
        if (code === "quotaExceeded") setRemaining(0);
        failBeforeAcceptance(code);
        finished = true;
        return;
      }
      for await (const event of readEvents(response)) {
        switch (event.type) {
          case "accepted":
            accepted = true;
            setMessages((list) =>
              list.map((m) =>
                m.id === localId
                  ? { ...m, id: event.userMessage.id, createdAt: event.userMessage.createdAt }
                  : m,
              ),
            );
            break;
          case "status":
            setPending((p) => (p ? { ...p, status: event.status } : p));
            break;
          case "suggestion":
            setPending((p) =>
              p ? { ...p, suggestions: [...p.suggestions, event.suggestion] } : p,
            );
            break;
          case "delta":
            setPending((p) => (p ? { ...p, text: p.text + event.text } : p));
            break;
          case "done":
            finished = true;
            setMessages((list) => [...list, event.message]);
            setRemaining(event.remaining);
            break;
          case "error":
            finished = true;
            setError(event.code);
            break;
        }
      }
      if (!finished) setError("network");
    } catch {
      const code: CoachErrorCode = timedOut ? "aiTimeout" : "network";
      if (accepted) setError(code);
      else failBeforeAcceptance(code);
    } finally {
      clearTimeout(timer);
      setPending(null);
      controller.current = null;
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const content = input.trim();
    setInput("");
    void run({ content });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function updateSuggestion(updated: SuggestionView) {
    setMessages((list) =>
      list.map((m) => ({
        ...m,
        suggestions: m.suggestions.map((s) => (s.id === updated.id ? updated : s)),
      })),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol aria-label={t("chat.label")} className="flex flex-col gap-4">
        <li>
          <Bubble role="ASSISTANT" author={t("chat.coach")}>
            {t(`modes.${mode}.welcome`)}
          </Bubble>
        </li>
        {messages.map((message) => (
          <li key={message.id} className="flex flex-col gap-3">
            <Bubble
              role={message.role}
              author={message.role === "USER" ? t("chat.you") : t("chat.coach")}
            >
              {message.content}
            </Bubble>
            {message.suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onChange={updateSuggestion}
              />
            ))}
          </li>
        ))}
        {pending ? (
          <li className="flex flex-col gap-3">
            {pending.text ? (
              <Bubble role="ASSISTANT" author={t("chat.coach")}>
                {pending.text}
              </Bubble>
            ) : null}
            {pending.suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onChange={updateSuggestion}
              />
            ))}
          </li>
        ) : null}
      </ol>

      <p aria-live="polite" className="min-h-5 text-sm text-stone-500">
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 animate-pulse rounded-full bg-stone-400 motion-reduce:animate-none"
            />
            {t(`chat.status.${pending.status}`)}
          </span>
        ) : null}
      </p>

      {exhausted && limit !== null ? <CoachUpsell limit={limit} billing={billing} /> : null}
      {error && error !== "quotaExceeded" ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <p className="font-medium">{t("errors.title")}</p>
          <p className="mt-1">{t(`errors.${error}`, { limit: limit ?? 0 })}</p>
          {canRetry ? <p className="mt-1">{t("errors.kept")}</p> : null}
        </div>
      ) : null}
      {canRetry && configured && error !== "tooManyRetries" ? (
        <div className="flex flex-wrap items-center gap-3">
          {!error ? <p className="text-sm text-stone-600">{t("chat.unanswered")}</p> : null}
          <button type="button" className={buttonClass} onClick={() => void run({ retry: true })}>
            {t("errors.retry")}
          </button>
        </div>
      ) : null}

      <form
        onSubmit={submit}
        className="sticky bottom-0 -mx-4 border-t border-stone-200 bg-stone-50/95 px-4 pt-3 pb-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-white sm:p-3"
      >
        <label htmlFor="coach-input" className="sr-only">
          {t("chat.inputLabel")}
        </label>
        <textarea
          id="coach-input"
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          disabled={!configured || exhausted}
          placeholder={t("chat.placeholder")}
          aria-invalid={tooLong || undefined}
          aria-describedby="coach-input-hint"
          className="focus:border-brand-600 block w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base placeholder:text-stone-400 focus:outline-none disabled:bg-stone-100 aria-[invalid=true]:border-red-600 sm:text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p id="coach-input-hint" className="text-xs text-stone-500">
            {tooLong
              ? t("chat.tooLong", { max: COACH_LIMITS.messageMaxChars })
              : !configured
                ? t("notConfigured")
                : remaining === null
                  ? t("quotaUnlimited")
                  : t("quota", { remaining })}
          </p>
          <button type="submit" disabled={!canSend} className={buttonClass}>
            {busy ? t("chat.sending") : t("chat.send")}
          </button>
        </div>
      </form>
      <div ref={endRef} />
    </div>
  );
}

function Bubble({
  role,
  author,
  children,
}: {
  role: "USER" | "ASSISTANT";
  author: string;
  children: React.ReactNode;
}) {
  const mine = role === "USER";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm sm:max-w-[80%] ${
          mine ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-900"
        }`}
      >
        <p className={`mb-1 text-xs font-medium ${mine ? "text-stone-300" : "text-stone-500"}`}>
          {author}
        </p>
        <div className="break-words whitespace-pre-wrap">{children}</div>
      </div>
    </div>
  );
}
