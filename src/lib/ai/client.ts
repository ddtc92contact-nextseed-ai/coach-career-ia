import { createHash } from "node:crypto";
import { z } from "zod";
import { logger as defaultLogger, type LogContext, type Logger } from "@/lib/logger";
import { AiError, isAiError, isContentRejection } from "./errors";
import { estimateCostUsd } from "./pricing";
import { estimateTokens, truncateToTokens } from "./tokens";
import type {
  AiProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from "./types";

/**
 * Client IA : ajoute à un fournisseur les délais, les reprises avec
 * temporisation exponentielle, la sortie JSON validée par zod (une tentative
 * de réparation), la boucle d'appel d'outils, le cache d'embeddings et le
 * journal d'usage.
 *
 * JOURNAL : uniquement fournisseur, modèle, usage (`purpose`), durée, nombre
 * de tentatives, jetons et coût estimé (et, pour un lot d'embeddings refusé,
 * ses compteurs). JAMAIS le contenu des prompts ni des réponses, qui peuvent
 * contenir des données personnelles.
 */

export type AiClientOptions = {
  provider: AiProvider;
  /** Délai maximal d'une tentative (ms). */
  timeoutMs?: number;
  /** Nombre de reprises après la première tentative. */
  maxRetries?: number;
  /** Délai de base de la temporisation exponentielle (ms). */
  backoffMs?: number;
  /** Nombre maximal d'entrées par lot d'embeddings. */
  embeddingBatchSize?: number;
  /** Budget de jetons (estimés) par lot d'embeddings. */
  embeddingBatchTokens?: number;
  /** Jetons (estimés) au plus par entrée : au-delà, l'entrée est tronquée. */
  embeddingInputTokens?: number;
  /** Nombre d'embeddings gardés en cache mémoire. */
  embeddingCacheSize?: number;
  logger?: Logger;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

export type CallSettings = {
  /** Annulation par l'appelant (délai global, requête interrompue). */
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
};

export type GenerateObjectRequest<T extends z.ZodType> = Omit<
  ChatRequest,
  "responseFormat" | "tools" | "toolChoice"
> &
  CallSettings & {
    schema: T;
    /** Schéma JSON montré au modèle ; par défaut, dérivé du schéma zod. */
    jsonSchema?: Record<string, unknown>;
  };

export type GenerateObjectResult<T> = { object: T; usage: TokenUsage; repaired: boolean };

export type Tool<A extends z.ZodType = z.ZodType> = {
  definition: ToolDefinition;
  args: A;
  execute: (args: z.infer<A>, context: { signal?: AbortSignal }) => Promise<unknown> | unknown;
};

export type RunToolsRequest = Omit<ChatRequest, "tools" | "responseFormat"> &
  CallSettings & {
    tools: Tool[];
    /** Nombre maximal d'allers-retours avec le modèle. */
    maxSteps?: number;
    /** Appelé avant chaque appel au modèle (progression affichée à l'utilisateur). */
    onStep?: (step: number) => void;
  };

export type RunToolsResult = {
  /** Dernière réponse (texte) du modèle. */
  content: string;
  /** Conversation complète, outils compris : à reprendre pour le tour suivant. */
  messages: ChatMessage[];
  steps: number;
  usage: TokenUsage;
};

/**
 * Limites des embeddings (issue #69) :
 * - mistral-embed accepte 8 192 jetons par entrée (fenêtre du modèle, doc
 *   Mistral « Embeddings ») ; on tronque à 4 000 jetons ESTIMÉS, la moitié,
 *   pour absorber l'écart entre `estimateTokens` et le vrai tokenizer ;
 * - par requête, l'API refuse au-delà d'un total de jetons (« Too many tokens
 *   overall, split into more batches », 400) dont la valeur n'est pas publiée ;
 *   le client officiel langchain-mistralai découpe ses lots à 16 000 jetons
 *   (`MAX_TOKENS` de `langchain_mistralai/embeddings.py`, vrai tokenizer) et
 *   des lots de ~22 000 jetons réels sont passés en production. Budget retenu :
 *   16 000 jetons estimés (estimation prudente) ;
 * - 32 entrées au plus par lot, comme avant.
 * Ces valeurs valent aussi pour un endpoint compatible OpenAI (Ollama), dont
 * les modèles d'embedding ont des fenêtres comparables ou plus larges.
 */
const DEFAULTS = {
  timeoutMs: 45_000,
  maxRetries: 2,
  backoffMs: 500,
  embeddingBatchSize: 32,
  embeddingBatchTokens: 16_000,
  embeddingInputTokens: 4_000,
  embeddingCacheSize: 2_000,
};
/**
 * Profondeur maximale de la dichotomie qui isole une entrée refusée : un lot
 * de 32 entrées se réduit à une entrée en 5 coupes. Au-delà, l'erreur remonte.
 */
const MAX_SPLIT_DEPTH = 6;
const MAX_BACKOFF_MS = 10_000;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});
const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/** Retire un éventuel bloc ```json … ``` autour de la réponse. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]! : trimmed;
}

/** Résumé des erreurs de validation pour la réparation : chemins et codes, pas de valeurs. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 20)
    .map((issue) => `- ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

export class AiClient {
  readonly provider: AiProvider;
  private readonly options: Required<Omit<AiClientOptions, "provider" | "logger">>;
  private readonly log: Logger;
  private readonly embeddingCache = new Map<string, number[]>();

  constructor(options: AiClientOptions) {
    this.provider = options.provider;
    this.log = options.logger ?? defaultLogger;
    this.options = {
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
      backoffMs: options.backoffMs ?? DEFAULTS.backoffMs,
      embeddingBatchSize: options.embeddingBatchSize ?? DEFAULTS.embeddingBatchSize,
      embeddingBatchTokens: options.embeddingBatchTokens ?? DEFAULTS.embeddingBatchTokens,
      embeddingInputTokens: options.embeddingInputTokens ?? DEFAULTS.embeddingInputTokens,
      embeddingCacheSize: options.embeddingCacheSize ?? DEFAULTS.embeddingCacheSize,
      sleep: options.sleep ?? defaultSleep,
      random: options.random ?? Math.random,
    };
  }

  /**
   * Exécute un appel avec délai par tentative et reprises sur les erreurs
   * transitoires (délai, 5xx, 429). L'annulation par l'appelant n'est jamais
   * reprise.
   */
  private async withRetries<T extends { usage: TokenUsage; model: string }>(
    kind: "chat" | "embed",
    purpose: string,
    settings: CallSettings,
    call: (signal: AbortSignal) => Promise<T>,
    /** Compteurs ajoutés au journal d'un échec (jamais de contenu). */
    failureContext?: LogContext,
  ): Promise<T> {
    const timeoutMs = settings.timeoutMs ?? this.options.timeoutMs;
    const maxRetries = settings.maxRetries ?? this.options.maxRetries;
    const started = Date.now();
    let attempt = 0;
    for (;;) {
      attempt++;
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = settings.signal ? AbortSignal.any([settings.signal, timeout]) : timeout;
      try {
        const result = await call(signal);
        this.logCall(kind, purpose, { ok: true, attempt, started, result });
        return result;
      } catch (raw) {
        const error = this.normalizeError(raw, settings.signal, timeout);
        const canRetry = error.retryable && attempt <= maxRetries && !settings.signal?.aborted;
        if (!canRetry) {
          this.logCall(kind, purpose, { ok: false, attempt, started, error }, failureContext);
          throw error;
        }
        const exponential = this.options.backoffMs * 2 ** (attempt - 1);
        const jitter = exponential * 0.25 * this.options.random();
        const delay = Math.min(
          MAX_BACKOFF_MS,
          Math.max(error.retryAfterMs ?? 0, exponential + jitter),
        );
        this.log.warn("ai.retry", {
          provider: this.provider.name,
          purpose,
          attempt,
          code: error.code,
          delayMs: Math.round(delay),
        });
        try {
          await this.options.sleep(delay, settings.signal);
        } catch {
          throw new AiError("aborted");
        }
      }
    }
  }

  private normalizeError(raw: unknown, caller: AbortSignal | undefined, timeout: AbortSignal) {
    if (isAiError(raw)) return raw;
    if (caller?.aborted) {
      // Délai global de l'appelant (`AbortSignal.timeout`) ou interruption.
      const reason = caller.reason as { name?: string } | undefined;
      return new AiError(reason?.name === "TimeoutError" ? "timeout" : "aborted");
    }
    if (timeout.aborted) return new AiError("timeout");
    return new AiError("unavailable");
  }

  private logCall(
    kind: "chat" | "embed",
    purpose: string,
    outcome: {
      ok: boolean;
      attempt: number;
      started: number;
      result?: { usage: TokenUsage; model: string };
      error?: AiError;
    },
    failureContext?: LogContext,
  ) {
    const model =
      outcome.result?.model ??
      (kind === "chat" ? this.provider.chatModel : this.provider.embeddingModel);
    const usage = outcome.result?.usage;
    const context = {
      provider: this.provider.name,
      model,
      purpose,
      attempts: outcome.attempt,
      durationMs: Date.now() - outcome.started,
      ...(usage
        ? {
            // Clés sans « token » : le logger masque ce motif.
            inputTok: usage.inputTokens,
            outputTok: usage.outputTokens,
            costUsd: estimateCostUsd(this.provider.name, model, usage),
          }
        : {}),
      ...(outcome.error
        ? {
            code: outcome.error.code,
            status: outcome.error.status,
            ...(outcome.error.providerMessage
              ? { providerMessage: outcome.error.providerMessage }
              : {}),
            ...(outcome.error.providerType ? { providerType: outcome.error.providerType } : {}),
            ...failureContext,
          }
        : {}),
    };
    if (outcome.ok) this.log.info(`ai.${kind}`, context);
    else this.log.warn(`ai.${kind}.failed`, context);
  }

  /** Un tour de conversation (texte, JSON ou appels d'outils). */
  chat(request: ChatRequest & CallSettings): Promise<ChatResponse> {
    const { signal, timeoutMs, maxRetries, ...chatRequest } = request;
    return this.withRetries("chat", request.purpose, { signal, timeoutMs, maxRetries }, (s) =>
      this.provider.chat(chatRequest, { signal: s }),
    );
  }

  /**
   * Sortie structurée : le modèle répond en JSON, validé par `schema`. En cas
   * de JSON invalide ou non conforme, UNE tentative de réparation lui renvoie
   * les erreurs (chemins et codes, sans valeurs) ; au-delà : `invalidOutput`.
   */
  async generateObject<T extends z.ZodType>(
    request: GenerateObjectRequest<T>,
  ): Promise<GenerateObjectResult<z.infer<T>>> {
    const { schema, jsonSchema, messages, ...rest } = request;
    const shape = jsonSchema ?? z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
    const instruction: ChatMessage = {
      role: "system",
      content: `Answer with one JSON object only, no prose and no Markdown. It must match this JSON Schema:\n${JSON.stringify(shape)}`,
    };
    let conversation: ChatMessage[] = [...messages, instruction];
    let usage = NO_USAGE;

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.chat({ ...rest, messages: conversation, responseFormat: "json" });
      usage = addUsage(usage, response.usage);
      let problem: string;
      try {
        const parsed = schema.safeParse(JSON.parse(stripCodeFence(response.content)));
        if (parsed.success) return { object: parsed.data, usage, repaired: attempt > 0 };
        problem = `It does not match the schema:\n${describeIssues(parsed.error)}`;
      } catch {
        problem = "It is not valid JSON.";
      }
      this.log.warn("ai.output.invalid", {
        provider: this.provider.name,
        purpose: request.purpose,
        attempt: attempt + 1,
      });
      conversation = [
        ...conversation,
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: `Your previous answer is invalid. ${problem}\nReturn the corrected JSON object only.`,
        },
      ];
    }
    throw new AiError("invalidOutput");
  }

  /**
   * Boucle d'appel d'outils : le modèle appelle des outils (arguments validés
   * par zod), reçoit leurs résultats, jusqu'à une réponse texte ou `maxSteps`.
   * Les erreurs d'un outil lui sont renvoyées sous forme de code, sans détail.
   */
  async runTools(request: RunToolsRequest): Promise<RunToolsResult> {
    const { tools, maxSteps = 5, messages, onStep, ...rest } = request;
    const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
    const conversation: ChatMessage[] = [...messages];
    let usage = NO_USAGE;

    for (let step = 1; step <= maxSteps; step++) {
      onStep?.(step);
      const response = await this.chat({
        ...rest,
        messages: conversation,
        // Dernier tour : on exige une réponse texte.
        tools: tools.map((tool) => tool.definition),
        toolChoice: step === maxSteps ? "none" : (rest.toolChoice ?? "auto"),
      });
      usage = addUsage(usage, response.usage);
      conversation.push({
        role: "assistant",
        content: response.content,
        ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
      });
      if (!response.toolCalls.length) {
        return { content: response.content, messages: conversation, steps: step, usage };
      }
      for (const call of response.toolCalls) {
        conversation.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: await this.executeTool(byName, call, rest.signal),
        });
      }
    }
    throw new AiError("invalidOutput");
  }

  private async executeTool(
    tools: Map<string, Tool>,
    call: ToolCall,
    signal?: AbortSignal,
  ): Promise<string> {
    const tool = tools.get(call.name);
    if (!tool) return JSON.stringify({ error: "unknown_tool" });
    let args: unknown;
    try {
      args = JSON.parse(call.arguments || "{}");
    } catch {
      return JSON.stringify({ error: "invalid_json_arguments" });
    }
    const parsed = tool.args.safeParse(args);
    if (!parsed.success) {
      return JSON.stringify({ error: "invalid_arguments", issues: describeIssues(parsed.error) });
    }
    try {
      const result = await tool.execute(parsed.data, { signal });
      return typeof result === "string" ? result : JSON.stringify(result ?? null);
    } catch {
      this.log.warn("ai.tool.failed", { tool: call.name });
      return JSON.stringify({ error: "tool_failed" });
    }
  }

  /**
   * Embeddings par lots, avec cache mémoire (clé : modèle + empreinte du
   * texte ; le texte lui-même n'est pas conservé comme clé). Renvoie un
   * vecteur par texte, dans l'ordre, ou `null` :
   * - pour un texte vide (ou fait d'espaces), jamais envoyé au fournisseur ;
   * - pour un texte que le fournisseur refuse SEUL (400 sur une entrée).
   *
   * Lots : au plus `embeddingBatchSize` entrées et `embeddingBatchTokens`
   * jetons estimés ; une entrée trop longue est tronquée à
   * `embeddingInputTokens`. Un lot refusé pour son contenu (400, 413, 422) est
   * coupé en deux et renvoyé, récursivement, pour isoler la ou les entrées
   * fautives ; le reste est embarqué. Si TOUTES les entrées d'un lot sont
   * refusées une à une, la requête elle-même est en cause (modèle,
   * configuration) : l'erreur remonte. Délais, 429 et 5xx : reprises
   * habituelles, sans découpage.
   */
  async embed(
    texts: string[],
    settings: CallSettings & { purpose: string },
  ): Promise<(number[] | null)[]> {
    const model = this.provider.embeddingModel;
    const keys = texts.map((text) =>
      text.trim() === "" ? null : createHash("sha256").update(`${model}\0${text}`).digest("base64"),
    );
    const found = new Map<string, number[] | null>();
    for (const key of keys) {
      const cached = key === null ? undefined : this.embeddingCache.get(key);
      if (cached) found.set(key!, cached);
    }
    const textByKey = new Map<string, string>();
    keys.forEach((key, i) => {
      if (key !== null && !found.has(key) && !textByKey.has(key)) {
        textByKey.set(key, truncateToTokens(texts[i]!, this.options.embeddingInputTokens));
      }
    });
    const emptyInputs = keys.filter((key) => key === null).length;

    let batch: { key: string; estTok: number }[] = [];
    let batchTokens = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      const entries = batch;
      batch = [];
      batchTokens = 0;
      await this.embedBatch(entries, textByKey, found, settings, { depth: 0, emptyInputs });
    };
    for (const [key, text] of textByKey) {
      const estTok = estimateTokens(text);
      if (
        batch.length >= this.options.embeddingBatchSize ||
        (batch.length > 0 && batchTokens + estTok > this.options.embeddingBatchTokens)
      ) {
        await flush();
      }
      batch.push({ key, estTok });
      batchTokens += estTok;
    }
    await flush();
    return keys.map((key) => (key === null ? null : (found.get(key) ?? null)));
  }

  /**
   * Un lot d'embeddings ; sur un refus de contenu, dichotomie (profondeur
   * bornée). Renvoie le nombre d'entrées embarquées.
   */
  private async embedBatch(
    batch: { key: string; estTok: number }[],
    textByKey: Map<string, string>,
    found: Map<string, number[] | null>,
    settings: CallSettings & { purpose: string },
    context: { depth: number; emptyInputs: number },
  ): Promise<number> {
    try {
      const response = await this.withRetries(
        "embed",
        settings.purpose,
        settings,
        (signal) =>
          this.provider.embed(
            batch.map(({ key }) => textByKey.get(key)!),
            { signal },
          ),
        {
          entries: batch.length,
          estTok: batch.reduce((sum, entry) => sum + entry.estTok, 0),
          maxEntryTok: Math.max(...batch.map((entry) => entry.estTok)),
          emptyInputs: context.emptyInputs,
          ...(context.depth > 0 ? { splitDepth: context.depth } : {}),
        },
      );
      batch.forEach(({ key }, index) => {
        found.set(key, response.vectors[index]!);
        this.remember(key, response.vectors[index]!);
      });
      return batch.length;
    } catch (error) {
      if (!isAiError(error) || !isContentRejection(error) || settings.signal?.aborted) throw error;
      if (batch.length === 1) {
        found.set(batch[0]!.key, null);
        this.log.warn("ai.embed.rejected", {
          provider: this.provider.name,
          purpose: settings.purpose,
          estTok: batch[0]!.estTok,
          chars: textByKey.get(batch[0]!.key)!.length,
          status: error.status,
        });
        return 0;
      }
      if (context.depth >= MAX_SPLIT_DEPTH) throw error;
      const middle = Math.ceil(batch.length / 2);
      const next = { ...context, depth: context.depth + 1 };
      const embedded =
        (await this.embedBatch(batch.slice(0, middle), textByKey, found, settings, next)) +
        (await this.embedBatch(batch.slice(middle), textByKey, found, settings, next));
      // Aucune entrée du lot acceptée : ce n'est pas une entrée, c'est la requête.
      if (embedded === 0 && context.depth === 0) throw error;
      return embedded;
    }
  }

  private remember(key: string, vector: number[]) {
    this.embeddingCache.delete(key);
    this.embeddingCache.set(key, vector);
    while (this.embeddingCache.size > this.options.embeddingCacheSize) {
      this.embeddingCache.delete(this.embeddingCache.keys().next().value!);
    }
  }
}

export function createAiClient(options: AiClientOptions): AiClient {
  return new AiClient(options);
}
