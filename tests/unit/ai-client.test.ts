import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiError,
  createAiClient,
  createMockProvider,
  createOpenAiCompatibleProvider,
  estimateTokens,
  scriptedReplies,
  truncateToTokens,
  type MockResponder,
} from "@/lib/ai";
import { aiClientFromEnv, providerFromEnv } from "@/lib/ai/config";
import { createLogger } from "@/lib/logger";

/** Données fictives « personnelles » : elles ne doivent jamais apparaître dans les journaux. */
const SECRET_NAME = "Jeanne Testard";
const SECRET_EMAIL = "jeanne.testard@exemple.test";

function setup(respond?: MockResponder, options: { timeoutMs?: number; maxRetries?: number } = {}) {
  const lines: string[] = [];
  const sleeps: number[] = [];
  const provider = createMockProvider({ respond });
  const client = createAiClient({
    provider,
    logger: createLogger({ level: "debug", write: (_l, line) => lines.push(line) }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0,
    ...options,
  });
  return { client, provider, lines, sleeps };
}

const personSchema = z.object({ role: z.string(), years: z.number().int() });
const ask = [{ role: "user" as const, content: `CV de ${SECRET_NAME}, ${SECRET_EMAIL}` }];

describe("AiClient.generateObject", () => {
  it("valide la réponse JSON (bloc ```json toléré)", async () => {
    const { client, provider } = setup(scriptedReplies('```json\n{"role":"dev","years":4}\n```'));
    const result = await client.generateObject({
      schema: personSchema,
      messages: ask,
      purpose: "test",
    });
    expect(result.object).toEqual({ role: "dev", years: 4 });
    expect(result.repaired).toBe(false);
    expect(provider.calls[0]!.responseFormat).toBe("json");
    // Le schéma JSON est donné au modèle.
    expect(provider.calls[0]!.messages.at(-1)!.content).toContain('"years"');
  });

  it("fait UNE tentative de réparation avec les erreurs de validation", async () => {
    const { client, provider } = setup(
      scriptedReplies('{"role":"dev","years":"quatre"}', '{"role":"dev","years":4}'),
    );
    const result = await client.generateObject({
      schema: personSchema,
      messages: ask,
      purpose: "test",
    });
    expect(result.object.years).toBe(4);
    expect(result.repaired).toBe(true);
    const repair = provider.calls[1]!.messages;
    expect(repair.at(-2)).toEqual({
      role: "assistant",
      content: '{"role":"dev","years":"quatre"}',
    });
    expect(repair.at(-1)!.content).toMatch(/years/);
  });

  it("échoue en `invalidOutput` si la réparation échoue aussi", async () => {
    const { client, provider } = setup(scriptedReplies("pas du JSON"));
    await expect(
      client.generateObject({ schema: personSchema, messages: ask, purpose: "test" }),
    ).rejects.toMatchObject({ code: "invalidOutput" });
    expect(provider.calls).toHaveLength(2);
  });
});

describe("AiClient : délais et reprises", () => {
  it("reprend une erreur transitoire avec temporisation exponentielle", async () => {
    const { client, provider, sleeps } = setup(
      scriptedReplies(
        { error: new AiError("unavailable", { status: 503 }) },
        { error: new AiError("rateLimited", { status: 429 }) },
        "bonjour",
      ),
      { maxRetries: 2 },
    );
    const response = await client.chat({ messages: ask, purpose: "test" });
    expect(response.content).toBe("bonjour");
    expect(provider.calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("respecte Retry-After quand il est plus long", async () => {
    const { client, sleeps } = setup(
      scriptedReplies({ error: new AiError("rateLimited", { retryAfterMs: 3000 }) }, "ok"),
    );
    await client.chat({ messages: ask, purpose: "test" });
    expect(sleeps).toEqual([3000]);
  });

  it("transforme un dépassement de délai en `timeout`, après les reprises", async () => {
    const { client, provider } = setup(scriptedReplies({ delayMs: 200, content: "trop tard" }), {
      timeoutMs: 20,
      maxRetries: 1,
    });
    await expect(client.chat({ messages: ask, purpose: "test" })).rejects.toMatchObject({
      code: "timeout",
    });
    expect(provider.calls).toHaveLength(2);
  });

  it("ne reprend pas une requête refusée (4xx) ni une annulation", async () => {
    const refused = setup(scriptedReplies({ error: new AiError("badRequest", { status: 400 }) }));
    await expect(refused.client.chat({ messages: ask, purpose: "test" })).rejects.toMatchObject({
      code: "badRequest",
    });
    expect(refused.provider.calls).toHaveLength(1);

    const aborted = setup(scriptedReplies({ delayMs: 500, content: "x" }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(
      aborted.client.chat({ messages: ask, purpose: "test", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(aborted.provider.calls).toHaveLength(1);
  });

  it("journalise l'usage et le coût, jamais le contenu", async () => {
    const { client, lines } = setup(
      scriptedReplies({ error: new AiError("unavailable") }, `{"role":"${SECRET_NAME}","years":2}`),
    );
    await client.generateObject({ schema: personSchema, messages: ask, purpose: "import.extract" });
    const call = lines.map((l) => JSON.parse(l)).find((l) => l.event === "ai.chat");
    expect(call).toMatchObject({
      provider: "mock",
      model: "mock-chat",
      purpose: "import.extract",
      attempts: 2,
      costUsd: 0,
    });
    expect(call.inputTok).toBeGreaterThan(0);
    expect(call.outputTok).toBeGreaterThan(0);
    const all = lines.join("\n");
    expect(all).not.toContain("Jeanne");
    expect(all).not.toContain("Testard");
    expect(all).not.toContain("exemple.test");
  });
});

describe("AiClient.runTools", () => {
  it("exécute les outils demandés puis renvoie la réponse finale", async () => {
    const { client, provider } = setup(
      scriptedReplies(
        { toolCalls: [{ id: "c1", name: "count_skills", arguments: '{"kind":"proven"}' }] },
        "Vous avez 3 compétences prouvées.",
      ),
    );
    const seen: unknown[] = [];
    const result = await client.runTools({
      purpose: "coach.chat",
      messages: [{ role: "user", content: "Combien de compétences prouvées ?" }],
      tools: [
        {
          definition: {
            name: "count_skills",
            description: "Compte les compétences",
            parameters: { type: "object", properties: { kind: { type: "string" } } },
          },
          args: z.object({ kind: z.enum(["proven", "all"]) }),
          execute: (args) => {
            seen.push(args);
            return { count: 3 };
          },
        },
      ],
    });
    expect(seen).toEqual([{ kind: "proven" }]);
    expect(result.content).toBe("Vous avez 3 compétences prouvées.");
    expect(result.steps).toBe(2);
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(result.messages[2]).toMatchObject({ toolCallId: "c1", content: '{"count":3}' });
    expect(provider.calls[0]!.tools?.[0]!.name).toBe("count_skills");
  });

  it("renvoie une erreur d'arguments au modèle sans exécuter l'outil", async () => {
    const { client } = setup(
      scriptedReplies(
        { toolCalls: [{ id: "c1", name: "count_skills", arguments: '{"kind":42}' }] },
        "Désolé.",
      ),
    );
    let executed = false;
    const result = await client.runTools({
      purpose: "coach.chat",
      messages: [{ role: "user", content: "?" }],
      tools: [
        {
          definition: { name: "count_skills", description: "", parameters: {} },
          args: z.object({ kind: z.string() }),
          execute: () => (executed = true),
        },
      ],
    });
    expect(executed).toBe(false);
    expect(result.messages[2]!.content).toContain("invalid_arguments");
  });
});

describe("AiClient.embed", () => {
  it("découpe en lots et met en cache", async () => {
    const provider = createMockProvider({ dimensions: 8 });
    const client = createAiClient({
      provider,
      embeddingBatchSize: 2,
      logger: createLogger({ write: () => {} }),
    });
    const first = await client.embed(["a", "b", "c", "a"], { purpose: "test" });
    expect(provider.embedCalls).toEqual([["a", "b"], ["c"]]);
    expect(first[0]).toEqual(first[3]);
    expect(first[0]).toHaveLength(8);
    expect(Math.hypot(...first[0]!)).toBeCloseTo(1);
    await client.embed(["b", "d"], { purpose: "test" });
    expect(provider.embedCalls.at(-1)).toEqual(["d"]);
  });

  function embedSetup(
    options: {
      reject?: (texts: string[]) => AiError | undefined;
      batchTokens?: number;
      inputTokens?: number;
      embedError?: AiError;
    } = {},
  ) {
    const lines: string[] = [];
    const provider = createMockProvider({
      dimensions: 4,
      embedReject: options.reject,
      embedError: options.embedError,
    });
    const client = createAiClient({
      provider,
      embeddingBatchTokens: options.batchTokens,
      embeddingInputTokens: options.inputTokens,
      logger: createLogger({ level: "debug", write: (_l, line) => lines.push(line) }),
      sleep: async () => {},
      random: () => 0,
    });
    const events = (event: string) =>
      lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.event === event);
    return { client, provider, lines, events };
  }

  /** Texte de `n` jetons estimés (lettres : 3 caractères par jeton). */
  const textOf = (tokens: number, tag: string) => `${tag}${"a".repeat(tokens * 3 - 3)}`;

  it("découpe les lots par budget de jetons estimés, en plus du nombre d'entrées", async () => {
    const { client, provider } = embedSetup({ batchTokens: 100 });
    const texts = [textOf(40, "aaa"), textOf(40, "bbb"), textOf(40, "ccc"), textOf(90, "ddd")];
    texts.push(textOf(5, "eee"), textOf(5, "fff"));
    const vectors = await client.embed(texts, { purpose: "test" });
    expect(provider.embedCalls.map((batch) => batch.map((t) => t.slice(0, 3)))).toEqual([
      ["aaa", "bbb"],
      ["ccc"],
      ["ddd", "eee", "fff"],
    ]);
    expect(vectors.every((v) => v?.length === 4)).toBe(true);
  });

  it("tronque une entrée au-delà de la limite par entrée", async () => {
    const { client, provider } = embedSetup({ inputTokens: 50 });
    const [vector] = await client.embed([textOf(500, "lng")], { purpose: "test" });
    expect(vector).toHaveLength(4);
    expect(estimateTokens(provider.embedCalls[0]![0]!)).toBeLessThanOrEqual(50);
    expect(provider.embedCalls[0]![0]!.startsWith("lng")).toBe(true);
  });

  it("écarte les entrées vides ou faites d'espaces (`null`, jamais envoyées)", async () => {
    const { client, provider } = embedSetup();
    const vectors = await client.embed(["a", "", " \n\t ", "b"], { purpose: "test" });
    expect(provider.embedCalls).toEqual([["a", "b"]]);
    expect(vectors.map((v) => (v === null ? null : v.length))).toEqual([4, null, null, 4]);
    // Que des entrées vides : aucun appel.
    expect(await client.embed(["", "  "], { purpose: "test" })).toEqual([null, null]);
    expect(provider.embedCalls).toHaveLength(1);
  });

  it("400 sur un lot de 32 avec une entrée empoisonnée : 31 vecteurs, l'entrée isolée et ignorée", async () => {
    const poison = `${SECRET_NAME} poison`;
    const { client, provider, lines, events } = embedSetup({
      reject: (texts) =>
        texts.includes(poison)
          ? new AiError("badRequest", {
              status: 400,
              providerMessage: "Too many tokens overall, split into more batches.",
              providerType: "invalid_request_error",
            })
          : undefined,
    });
    const texts = Array.from({ length: 32 }, (_, i) => (i === 21 ? poison : `offre ${i}`));
    const vectors = await client.embed(texts, { purpose: "matching.offers" });

    expect(vectors.filter((v) => v !== null)).toHaveLength(31);
    expect(vectors[21]).toBeNull();
    // Dichotomie : 1 lot + 2 moitiés par niveau jusqu'à l'entrée seule (5 niveaux).
    expect(provider.embedCalls).toHaveLength(11);
    expect(provider.embedCalls.flat().filter((t) => t === poison)).toHaveLength(6);

    const failed = events("ai.embed.failed");
    expect(failed).toHaveLength(6);
    expect(failed[0]).toMatchObject({
      purpose: "matching.offers",
      code: "badRequest",
      status: 400,
      attempts: 1,
      entries: 32,
      maxEntryTok: estimateTokens(poison),
      estTok: texts.reduce((n, t) => n + estimateTokens(t), 0),
      emptyInputs: 0,
      providerMessage: "Too many tokens overall, split into more batches.",
      providerType: "invalid_request_error",
    });
    expect(failed.map((f) => f.entries)).toEqual([32, 16, 8, 4, 2, 1]);
    expect(events("ai.embed.rejected")).toEqual([
      expect.objectContaining({ estTok: estimateTokens(poison), chars: poison.length }),
    ]);
    for (const line of lines) {
      expect(line).not.toContain("Jeanne");
      expect(line).not.toContain("offre ");
    }
    // Le cache garde les 31 vecteurs, pas le refus : un nouvel appel ne renvoie que l'entrée fautive.
    await client.embed(texts, { purpose: "matching.offers" });
    expect(provider.embedCalls.at(-1)).toEqual([poison]);
  });

  it("refus de toutes les entrées : c'est la requête qui est en cause, l'erreur remonte", async () => {
    const { client, provider } = embedSetup({
      reject: () => new AiError("badRequest", { status: 400 }),
    });
    await expect(client.embed(["a", "b", "c", "d"], { purpose: "test" })).rejects.toMatchObject({
      code: "badRequest",
      status: 400,
    });
    expect(provider.embedCalls).toHaveLength(7);
  });

  it("une entrée seule refusée donne `null` ; un 401 n'est jamais imputé à une entrée", async () => {
    const single = embedSetup({ reject: () => new AiError("badRequest", { status: 400 }) });
    expect(await single.client.embed(["seule"], { purpose: "test" })).toEqual([null]);

    const auth = embedSetup({ reject: () => new AiError("badRequest", { status: 401 }) });
    await expect(auth.client.embed(["a", "b"], { purpose: "test" })).rejects.toMatchObject({
      status: 401,
    });
    expect(auth.provider.embedCalls).toHaveLength(1);
  });

  it("429, 5xx et délais : reprises habituelles, sans découpage", async () => {
    const { client, provider, events } = embedSetup({
      embedError: new AiError("unavailable", { status: 503 }),
    });
    await expect(client.embed(["a", "b"], { purpose: "test" })).rejects.toMatchObject({
      code: "unavailable",
    });
    // 1 tentative + 2 reprises, toujours le lot entier.
    expect(provider.embedCalls).toEqual([
      ["a", "b"],
      ["a", "b"],
      ["a", "b"],
    ]);
    expect(events("ai.embed.failed")[0]).toMatchObject({ attempts: 3, entries: 2 });
  });
});

describe("Estimation des jetons", () => {
  it("compte les lettres par 3 et les chiffres et symboles un par un", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcdef")).toBe(2);
    expect(estimateTokens("éèàçùô")).toBe(2);
    expect(estimateTokens("123/45")).toBe(6);
    expect(estimateTokens("https://ex.fr/a?b=1")).toBeGreaterThan(estimateTokens("https exfr ab"));
  });

  it("tronque sous la limite sans couper un caractère", () => {
    const text = "😀".repeat(10) + "abc";
    const cut = truncateToTokens(text, 4);
    expect(cut).toBe("😀😀😀😀");
    expect(truncateToTokens("abc", 4)).toBe("abc");
  });
});

describe("Fournisseur compatible OpenAI (Mistral, Ollama)", () => {
  function fakeFetch(handler: (url: string, body: Record<string, unknown>) => Response) {
    const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push({ url, body, headers: new Headers(init.headers) });
      return handler(url, body);
    };
    return { fetch, requests };
  }
  const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  const signal = new AbortController().signal;

  it("envoie messages, outils et mode JSON au format attendu", async () => {
    const { fetch, requests } = fakeFetch(() =>
      json({
        model: "mistral-small-2506",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "",
              tool_calls: [
                { id: "t1", type: "function", function: { name: "f", arguments: { a: 1 } } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );
    const provider = createOpenAiCompatibleProvider({
      name: "mistral",
      baseUrl: "https://api.mistral.test/v1/",
      apiKey: "cle-de-test",
      chatModel: "mistral-small-latest",
      embeddingModel: "mistral-embed",
      fetch,
    });
    const response = await provider.chat(
      {
        purpose: "test",
        messages: [
          { role: "system", content: "s" },
          { role: "assistant", content: "", toolCalls: [{ id: "t0", name: "f", arguments: "{}" }] },
          { role: "tool", toolCallId: "t0", name: "f", content: "{}" },
        ],
        tools: [{ name: "f", description: "d", parameters: { type: "object" } }],
        toolChoice: "required",
        responseFormat: "json",
        temperature: 0,
      },
      { signal },
    );
    const { url, body, headers } = requests[0]!;
    expect(url).toBe("https://api.mistral.test/v1/chat/completions");
    expect(headers.get("authorization")).toBe("Bearer cle-de-test");
    expect(body).toMatchObject({
      model: "mistral-small-latest",
      temperature: 0,
      response_format: { type: "json_object" },
      tool_choice: "any",
      tools: [{ type: "function", function: { name: "f" } }],
    });
    expect((body.messages as unknown[])[1]).toMatchObject({ tool_calls: [{ id: "t0" }] });
    expect((body.messages as unknown[])[2]).toMatchObject({ role: "tool", tool_call_id: "t0" });
    expect(response).toMatchObject({
      toolCalls: [{ id: "t1", name: "f", arguments: '{"a":1}' }],
      finishReason: "tool_calls",
      usage: { inputTokens: 12, outputTokens: 3 },
      model: "mistral-small-2506",
    });
  });

  it("convertit les statuts HTTP en codes, sans reprendre le corps de la réponse", async () => {
    const make = (status: number, headers: Record<string, string> = {}) =>
      createOpenAiCompatibleProvider({
        name: "openai-compatible",
        baseUrl: "http://127.0.0.1:11434/v1",
        chatModel: "qwen3",
        embeddingModel: "nomic-embed-text",
        fetch: async () => json({ error: `écho de ${SECRET_NAME}` }, status, headers),
      });
    const request = { purpose: "test", messages: ask };
    const limited = await make(429, { "retry-after": "2" })
      .chat(request, { signal })
      .catch((e) => e);
    expect(limited).toMatchObject({ code: "rateLimited", status: 429, retryAfterMs: 2000 });
    expect(limited.message).not.toContain("Jeanne");
    await expect(make(503).chat(request, { signal })).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(make(401).chat(request, { signal })).rejects.toMatchObject({ code: "badRequest" });
  });

  it("embeddings : reprend le message d'erreur du fournisseur seulement s'il ne cite aucune entrée", async () => {
    const make = (body: unknown, status = 400) =>
      createOpenAiCompatibleProvider({
        name: "mistral",
        baseUrl: "https://api.mistral.test/v1",
        chatModel: "m",
        embeddingModel: "mistral-embed",
        fetch: async () => json(body, status),
      });
    const inputs = [`Poste chez Datafleur, contact ${SECRET_NAME}`, "Data engineer"];

    const tooBig = await make({
      object: "error",
      message: "Too many tokens overall, split into more batches.",
      type: "invalid_request_error",
      code: null,
    })
      .embed(inputs, { signal })
      .catch((e) => e);
    expect(tooBig).toMatchObject({
      code: "badRequest",
      status: 400,
      providerMessage: "Too many tokens overall, split into more batches.",
      providerType: "invalid_request_error",
    });
    expect(tooBig.message).toBe("IA : badRequest (HTTP 400)");

    const echo = await make({
      message: `Invalid input: Poste chez Datafleur, contact ${SECRET_NAME}`,
      type: "invalid_request_error",
    })
      .embed(inputs, { signal })
      .catch((e) => e);
    expect(echo.providerMessage).toBeUndefined();
    expect(echo.providerType).toBe("invalid_request_error");

    const validation = await make(
      { detail: [{ type: "string_too_long", msg: "too long", input: inputs[0] }] },
      422,
    )
      .embed(inputs, { signal })
      .catch((e) => e);
    expect(validation).toMatchObject({ status: 422, providerType: "string_too_long" });
    expect(validation.providerMessage).toBeUndefined();

    const long = await make({ message: "x ".repeat(500) })
      .embed(inputs, { signal })
      .catch((e) => e);
    expect(long.providerMessage.length).toBeLessThanOrEqual(200);
  });

  it("une erreur réseau devient `unavailable`", async () => {
    const provider = createOpenAiCompatibleProvider({
      name: "openai-compatible",
      baseUrl: "http://127.0.0.1:1/v1",
      chatModel: "m",
      embeddingModel: "e",
      fetch: async () => {
        throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:1");
      },
    });
    await expect(provider.chat({ purpose: "t", messages: ask }, { signal })).rejects.toMatchObject({
      code: "unavailable",
      message: "IA : unavailable",
    });
  });

  it("lit les embeddings dans l'ordre des index", async () => {
    const { fetch, requests } = fakeFetch(() =>
      json({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
        usage: { prompt_tokens: 4 },
      }),
    );
    const provider = createOpenAiCompatibleProvider({
      name: "mistral",
      baseUrl: "https://api.mistral.test/v1",
      chatModel: "m",
      embeddingModel: "mistral-embed",
      fetch,
    });
    const result = await provider.embed(["a", "b"], { signal });
    expect(requests[0]!.body).toEqual({ model: "mistral-embed", input: ["a", "b"] });
    expect(result.vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });
});

describe("Configuration du fournisseur", () => {
  it("utilise TOUJOURS le simulateur pendant les tests", () => {
    expect(process.env.VITEST).toBeTruthy();
    expect(
      providerFromEnv({ ...process.env, AI_PROVIDER: "mistral", MISTRAL_API_KEY: "x" })!.name,
    ).toBe("mock");
  });

  it("choisit Mistral par défaut, ou un endpoint compatible OpenAI", () => {
    expect(providerFromEnv({ MISTRAL_API_KEY: "k" })).toMatchObject({
      name: "mistral",
      chatModel: "mistral-small-latest",
      embeddingModel: "mistral-embed",
    });
    expect(providerFromEnv({})).toBeNull();
    expect(
      providerFromEnv({
        AI_PROVIDER: "openai-compatible",
        OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:11434/v1",
        OPENAI_COMPAT_CHAT_MODEL: "qwen3-coder",
      }),
    ).toMatchObject({ name: "openai-compatible", chatModel: "qwen3-coder" });
    expect(() => aiClientFromEnv({})).toThrow(AiError);
  });
});
