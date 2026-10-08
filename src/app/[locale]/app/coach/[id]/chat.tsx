"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
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

/** Idées de premier message, par mode (remplissent la zone de saisie). */
const CHIPS = ["first", "second", "third"] as const;

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
  // Dernière réponse complète, lue une seule fois par les lecteurs d'écran
  // (le texte en cours de rédaction n'est pas annoncé morceau par morceau).
  const [announcement, setAnnouncement] = useState("");
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
    setAnnouncement("");
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
            setAnnouncement(t("chat.replyAnnounce", { text: event.message.content }));
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

  function pickChip(text: string) {
    setInput(text);
    inputRef.current?.focus();
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

  const showChips = configured && !busy && !exhausted && !messages.some((m) => m.role === "USER");
  const showRetry = canRetry && configured && error !== "tooManyRetries";
  const retryButton = (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={() => void run({ retry: true })}
    >
      <Icon name="refresh" className="size-4" />
      {t("errors.retry")}
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Titre de section pour l'ordre des titres (les suggestions sont des h3). */}
      <h2 className="sr-only">{t("chat.label")}</h2>
      <ol aria-label={t("chat.label")} className="flex flex-col gap-5">
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
            <Bubble role="ASSISTANT" author={t("chat.coach")} working={!pending.text}>
              {pending.text ? (
                pending.text
              ) : (
                <span className="text-ink-muted inline-flex items-center gap-3">
                  <TypingDots />
                  {t(`chat.status.${pending.status}`)}
                </span>
              )}
            </Bubble>
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

      {/* Annonces aux lecteurs d'écran : l'étape en cours, puis la réponse complète. */}
      <p aria-live="polite" className="sr-only">
        {pending ? t(`chat.status.${pending.status}`) : announcement}
      </p>
      {pending?.text ? (
        <p
          aria-hidden="true"
          className="text-ink-subtle -mt-2 flex items-center gap-2 pl-12 text-sm"
        >
          <TypingDots />
          {t(`chat.status.${pending.status}`)}
        </p>
      ) : null}

      {exhausted && limit !== null ? <CoachUpsell limit={limit} billing={billing} /> : null}
      {error && error !== "quotaExceeded" ? (
        <div
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink flex items-start gap-3 rounded-2xl border px-4 py-4"
        >
          <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("errors.title")}</p>
            <p className="mt-1">{t(`errors.${error}`, { limit: limit ?? 0 })}</p>
            {canRetry ? <p className="mt-1">{t("errors.kept")}</p> : null}
            {showRetry ? <div className="mt-3">{retryButton}</div> : null}
          </div>
        </div>
      ) : showRetry ? (
        <div className="border-warning-line bg-warning-soft text-warning-ink flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3">
          <p className="flex items-center gap-2">
            <Icon name="clock" className="size-5 shrink-0" />
            {t("chat.unanswered")}
          </p>
          {retryButton}
        </div>
      ) : null}

      <div className="bg-canvas/90 sticky bottom-0 z-10 -mx-4 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:px-0">
        {showChips ? (
          <div className="mb-3">
            <p id="coach-chips" className="text-ink-subtle mb-2 text-sm font-medium">
              {t("chat.chipsLabel")}
            </p>
            <ul aria-labelledby="coach-chips" className="flex flex-wrap gap-2">
              {CHIPS.map((key) => {
                const text = t(`chat.chips.${mode}.${key}`);
                return (
                  <li key={key} className="max-w-full">
                    <button
                      type="button"
                      onClick={() => pickChip(text)}
                      className="border-brand-line bg-surface text-ink hover:bg-brand-soft max-w-full rounded-full border px-3.5 py-2 text-left text-sm font-medium shadow-xs motion-safe:transition-colors"
                    >
                      {text}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <form
          onSubmit={submit}
          className="border-line-strong bg-surface focus-within:border-brand focus-within:ring-brand/20 rounded-2xl border p-2 shadow-md focus-within:ring-3 sm:p-3"
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
            rows={2}
            disabled={!configured || exhausted}
            placeholder={t("chat.placeholder")}
            aria-invalid={tooLong || undefined}
            aria-describedby="coach-input-hint"
            className="placeholder:text-ink-subtle text-ink block max-h-60 min-h-14 w-full resize-y bg-transparent px-2 py-1.5 text-base focus:outline-none disabled:cursor-not-allowed"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <p
              id="coach-input-hint"
              className={`text-sm ${tooLong ? "text-danger-ink font-medium" : "text-ink-subtle"}`}
            >
              {tooLong
                ? t("chat.tooLong", { max: COACH_LIMITS.messageMaxChars })
                : !configured
                  ? t("notConfigured")
                  : remaining === null
                    ? t("quotaUnlimited")
                    : t("quota", { remaining })}
            </p>
            <button type="submit" disabled={!canSend} className={buttonClass("primary")}>
              {busy ? t("chat.sending") : t("chat.send")}
              <Icon name="send" className="size-4" />
            </button>
          </div>
        </form>
      </div>
      <div ref={endRef} />
    </div>
  );
}

/** Trois points qui « tapent » : le coach rédige (immobiles en mouvement réduit). */
function TypingDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="bg-brand size-1.5 rounded-full motion-safe:animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

function Bubble({
  role,
  author,
  working = false,
  children,
}: {
  role: "USER" | "ASSISTANT";
  author: string;
  /** Le coach n'a encore rien écrit : bulle d'attente. */
  working?: boolean;
  children: React.ReactNode;
}) {
  const mine = role === "USER";
  return (
    <div className={`flex items-end gap-3 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine ? (
        <span
          aria-hidden="true"
          className="bg-night text-signal ring-night-line inline-flex size-9 shrink-0 items-center justify-center rounded-full ring-1"
        >
          <Icon name="spark" className="size-4.5" />
        </span>
      ) : null}
      <div
        className={`max-w-[85%] min-w-0 rounded-2xl px-4 py-3 text-base leading-relaxed sm:max-w-[78%] sm:px-5 sm:py-3.5 ${
          mine
            ? "bg-primary text-on-primary rounded-br-md shadow-sm"
            : `border-line bg-surface text-ink rounded-bl-md border shadow-xs ${
                working ? "border-dashed" : ""
              }`
        }`}
      >
        <p
          className={`mb-1 text-xs font-semibold ${mine ? "text-on-primary/80" : "text-brand-ink"}`}
        >
          {author}
        </p>
        <div className="break-words whitespace-pre-wrap">{children}</div>
      </div>
    </div>
  );
}
