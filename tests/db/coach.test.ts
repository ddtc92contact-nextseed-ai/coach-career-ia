import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AiError,
  createAiClient,
  createMockProvider,
  scriptedReplies,
  type ChatRequest,
  type MockReply,
} from "@/lib/ai";
import { createLogger } from "@/lib/logger";
import type { CoachStreamEvent } from "@/lib/coach/shared";

// Base de test, session et fournisseur IA simulés : le code applicatif est exécuté tel quel.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "fr" }));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn() }));
const ai = {
  replies: [] as MockReply[],
  timeoutMs: 5_000,
  calls: [] as ChatRequest[],
};
vi.mock("@/lib/ai/server", () => ({
  isAiConfigured: () => true,
  getAiClient: () => {
    const provider = createMockProvider({ respond: scriptedReplies(...ai.replies) });
    ai.calls = provider.calls;
    return createAiClient({
      provider,
      logger: createLogger({ write: () => {} }),
      sleep: async () => {},
      maxRetries: 0,
      timeoutMs: ai.timeoutMs,
    });
  },
}));

const { db } = await import("@/lib/db");
const { getCurrentUser, requireUser } = await import("@/lib/auth/session");
const careerRepo = await import("@/lib/career/repository");
const coachRepo = await import("@/lib/coach/repository");
const { POST: postMessage } = await import("@/app/api/coach/conversations/[id]/messages/route");
const { GET: getConversationRoute } = await import("@/app/api/coach/conversations/[id]/route");
const { GET: exportRoute } = await import("@/app/api/account/export/route");
const actions = await import("@/app/[locale]/app/coach/actions");

const url = process.env.TEST_DATABASE_URL;

type User = { id: string; email: string };

async function newUser(label: string): Promise<User> {
  return db.user.create({
    data: {
      email: `${label}.testard-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`,
      locale: "fr",
    },
  });
}

function asUser(user: User | null) {
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  vi.mocked(requireUser).mockImplementation(async () => {
    if (!user) throw new Error("redirection vers la connexion");
    return user;
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function send(conversationId: string, body: unknown) {
  return postMessage(
    new Request(`http://test/api/coach/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(conversationId),
  );
}

async function events(response: Response): Promise<CoachStreamEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CoachStreamEvent);
}

const call = (name: string, args: unknown, id = name) => ({
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});

describe.skipIf(!url)("coach IA : conversation, outils et suggestions", () => {
  let alice: User;
  let bob: User;
  let experienceId: string;
  const logLines: string[] = [];

  beforeAll(async () => {
    process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    alice = await newUser("jeanne");
    bob = await newUser("bob");
    const experience = await careerRepo.createExperience(alice.id, {
      roleTitle: "Data engineer",
      startMonth: "2021-01",
      endMonth: undefined,
      seniority: "SENIOR",
      contractType: "CDI",
      sector: "FINTECH",
      companySize: "S201_500",
      companyStage: "SCALEUP",
      responsibilities: "",
    });
    experienceId = experience.id;
    // Journal capturé : il ne doit contenir aucun contenu de message.
    const capture = (...args: unknown[]) => void logLines.push(args.map(String).join(" "));
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
  });

  afterEach(() => {
    ai.timeoutMs = 5_000;
    delete process.env.COACH_MESSAGES_PER_DAY;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
  });

  it("déroule une séquence d'outils scriptée : suggestion créée, mémoire inchangée", async () => {
    asUser(alice);
    const { id } = await coachRepo.createConversation(alice.id, "DISCOVER");
    ai.replies = [
      call("read_career_memory", {}),
      call("propose_achievement", {
        title: "Pipeline de scoring chez Qonto",
        context: "Fraude en hausse, contact jeanne.testard@exemple.test",
        actions: "J'ai conçu le modèle avec Paul Durand",
        result: "-30 % de fraude en 6 mois",
        skills: ["Python", "SQL"],
        experienceId,
        proofUrl: "https://www.linkedin.com/in/jeanne-testard",
        rationale: "Réalisation chiffrée décrite par Jeanne",
        identifyingTerms: ["Qonto", "Paul Durand"],
      }),
      "J'ai proposé cette réalisation : vérifiez la carte avant de l'accepter.",
    ];
    const response = await send(id, { content: "Chez Qonto j'ai réduit la fraude de 30 %." });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const stream = await events(response);
    const types = stream.map((e) => e.type);
    expect(types[0]).toBe("accepted");
    expect(types).toContain("suggestion");
    expect(types).toContain("delta");
    expect(types.at(-1)).toBe("done");
    expect(stream).toContainEqual({ type: "status", status: "reading" });

    // Le modèle a reçu la mémoire pseudonymisée, sans l'adresse e-mail.
    const toolResult = ai.calls[1]!.messages.find((m) => m.role === "tool")!;
    expect(toolResult.content).toContain("Data engineer");
    expect(toolResult.content).not.toContain(alice.email);
    // Consignes : transparence et langue de l'utilisateur.
    expect(ai.calls[0]!.messages[0]!.content).toContain("You are an AI assistant");
    expect(ai.calls[0]!.messages[0]!.content).toContain("Always answer in French");

    const suggestion = stream.find((e) => e.type === "suggestion")!;
    if (suggestion.type !== "suggestion" || suggestion.suggestion.kind !== "ACHIEVEMENT") {
      throw new Error("suggestion attendue");
    }
    const data = suggestion.suggestion.data;
    expect(suggestion.suggestion.status).toBe("PENDING");
    expect(suggestion.suggestion.identityRemoved).toBe(true);
    const texts = JSON.stringify(data) + suggestion.suggestion.rationale;
    for (const term of ["Qonto", "Paul", "Durand", "jeanne", "exemple.test", "linkedin"]) {
      expect(texts.toLowerCase()).not.toContain(term.toLowerCase());
    }
    expect(data.result).toBe("-30 % de fraude en 6 mois");
    expect(data.proofUrl).toBeUndefined();

    // Rien dans la mémoire de carrière avant l'acceptation.
    expect(await db.achievement.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.skill.count({ where: { userId: alice.id } })).toBe(0);

    // La conversation est persistée, chiffrée au repos.
    const conversation = await coachRepo.getConversation(alice.id, id);
    expect(conversation!.messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(conversation!.messages[1]!.suggestions.map((s) => s.id)).toEqual([
      suggestion.suggestion.id,
    ]);
    const raw = await db.coachMessage.findMany({ where: { conversationId: id } });
    for (const row of raw) expect(row.contentEnc).not.toContain("fraude");

    // Le candidat accepte : la réalisation arrive dans la mémoire, une seule fois.
    const accepted = await actions.acceptCoachSuggestion(suggestion.suggestion.id);
    expect(accepted.ok).toBe(true);
    const achievements = await careerRepo.listAchievements(alice.id);
    expect(achievements).toHaveLength(1);
    expect(achievements[0]).toMatchObject({ result: "-30 % de fraude en 6 mois", experienceId });
    expect(achievements[0]!.skills.map((s) => s.name)).toEqual(["Python", "SQL"]);
    const again = await actions.acceptCoachSuggestion(suggestion.suggestion.id);
    expect(again.ok).toBe(false);
    expect(await db.achievement.count({ where: { userId: alice.id } })).toBe(1);

    // Aucun contenu de message ni donnée personnelle dans les journaux.
    const logs = logLines.join("\n");
    expect(logs).toContain("coach.turn");
    for (const secret of ["Qonto", "fraude", "Paul", alice.email, "vérifiez la carte"]) {
      expect(logs).not.toContain(secret);
    }
  });

  it("une suggestion modifiée puis acceptée, ou rejetée, suit le choix du candidat", async () => {
    asUser(alice);
    const { id } = await coachRepo.createConversation(alice.id, "DISCOVER");
    ai.replies = [
      {
        toolCalls: [
          { id: "a", name: "propose_skill", arguments: JSON.stringify({ name: "dbt" }) },
          { id: "b", name: "propose_skill", arguments: JSON.stringify({ name: "Airflow" }) },
          {
            id: "c",
            name: "propose_experience_update",
            arguments: JSON.stringify({ experienceId, responsibilities: "Équipe de 4" }),
          },
        ],
      },
      "Trois propositions.",
    ];
    const stream = await events(await send(id, { content: "J'utilise dbt et Airflow." }));
    const suggestions = stream.flatMap((e) => (e.type === "suggestion" ? [e.suggestion] : []));
    expect(suggestions.map((s) => s.kind)).toEqual(["SKILL", "SKILL", "EXPERIENCE_UPDATE"]);
    const [dbt, airflow, update] = suggestions;

    expect((await actions.rejectCoachSuggestion(airflow!.id)).ok).toBe(true);
    expect((await actions.acceptCoachSuggestion(airflow!.id)).ok).toBe(false);
    const edited = await actions.acceptCoachSuggestion(dbt!.id, { name: "dbt Core" });
    expect(edited.ok).toBe(true);
    const skills = (await careerRepo.listSkills(alice.id)).map((s) => s.name);
    expect(skills).toContain("dbt Core");
    expect(skills).not.toContain("Airflow");
    expect(skills).not.toContain("dbt");

    // Contenu modifié invalide : refusé, la suggestion reste en attente.
    const invalid = await actions.acceptCoachSuggestion(update!.id, {
      experienceId,
      changes: { roleTitle: "" },
    });
    expect(invalid).toEqual({ ok: false, errors: expect.any(Object) });
    expect((await careerRepo.getExperience(alice.id, experienceId))!.responsibilities).toBe("");
    expect((await actions.acceptCoachSuggestion(update!.id)).ok).toBe(true);
    expect((await careerRepo.getExperience(alice.id, experienceId))!.responsibilities).toBe(
      "Équipe de 4",
    );
  });

  it("propose des garde-fous en mode « Clarifier », appliqués à l'acceptation seulement", async () => {
    asUser(alice);
    const { id } = await coachRepo.createConversation(alice.id, "CLARIFY");
    ai.replies = [
      call("propose_guard_rail_change", {
        minFixedSalary: 55000,
        remotePolicy: "HYBRID",
        minRemoteDays: 2,
        locations: [{ label: "Lyon", radiusKm: 30 }],
        rationale: "Plancher annoncé",
      }),
      "Je vous propose ces garde-fous.",
    ];
    const stream = await events(
      await send(id, { content: "Pas moins de 55 k€, 2 jours de télétravail." }),
    );
    // Outils limités par compétence : pas de proposition de réalisation ici.
    expect(ai.calls[0]!.tools!.map((t) => t.name)).toEqual([
      "read_career_memory",
      "propose_guard_rail_change",
    ]);
    const suggestion = stream.find((e) => e.type === "suggestion");
    if (suggestion?.type !== "suggestion") throw new Error("suggestion attendue");
    expect((await careerRepo.getGuardRails(alice.id)).minFixedSalary).toBeNull();

    expect((await actions.acceptCoachSuggestion(suggestion.suggestion.id)).ok).toBe(true);
    const rails = await careerRepo.getGuardRails(alice.id);
    expect(rails).toMatchObject({
      minFixedSalary: 55000,
      remotePolicy: "HYBRID",
      minRemoteDays: 2,
    });
    expect(rails.locations).toMatchObject([{ label: "Lyon", radiusKm: 30 }]);
  });

  it("panne, lenteur ou sortie inexploitable : erreur visible, conversation conservée", async () => {
    asUser(alice);
    const { id } = await coachRepo.createConversation(alice.id, "INTERVIEW");

    ai.replies = [{ error: new AiError("unavailable", { status: 503 }) }];
    const down = await events(await send(id, { content: "Premier message" }));
    expect(down.map((e) => e.type)).toEqual(["accepted", "status", "error"]);
    expect(down.at(-1)).toEqual({ type: "error", code: "aiUnavailable" });

    // Le message du candidat est conservé, sans réponse fantôme.
    let conversation = await coachRepo.getConversation(alice.id, id);
    expect(conversation!.messages.map((m) => [m.role, m.content])).toEqual([
      ["USER", "Premier message"],
    ]);

    ai.timeoutMs = 20;
    ai.replies = [{ content: "trop tard", delayMs: 500 }];
    const slow = await events(await send(id, { retry: true }));
    expect(slow.at(-1)).toEqual({ type: "error", code: "aiTimeout" });

    ai.timeoutMs = 5_000;
    ai.replies = [{ content: "   " }];
    const empty = await events(await send(id, { retry: true }));
    expect(empty.at(-1)).toEqual({ type: "error", code: "aiInvalidOutput" });

    // Le modèle boucle sur les outils : arrêt au nombre maximal d'étapes.
    ai.replies = [call("read_career_memory", {})];
    const looping = await events(await send(id, { retry: true }));
    expect(looping.at(-1)).toEqual({ type: "error", code: "aiInvalidOutput" });

    // Arguments d'outil illisibles : l'erreur est renvoyée au modèle, le tour aboutit.
    ai.replies = [
      { toolCalls: [{ id: "x", name: "read_career_memory", arguments: "{oops" }] },
      "Reprenons.",
    ];
    const recovered = await events(await send(id, { retry: true }));
    expect(recovered.at(-1)).toMatchObject({ type: "done" });
    conversation = await coachRepo.getConversation(alice.id, id);
    expect(conversation!.messages.map((m) => m.content)).toEqual(["Premier message", "Reprenons."]);

    // Plus rien à relancer une fois la réponse reçue.
    expect((await send(id, { retry: true })).status).toBe(400);
  });

  it("abandonne les suggestions d'un tour qui échoue", async () => {
    asUser(alice);
    const { id } = await coachRepo.createConversation(alice.id, "DISCOVER");
    ai.replies = [call("propose_skill", { name: "Kafka" }), { error: new AiError("unavailable") }];
    const stream = await events(await send(id, { content: "Kafka" }));
    expect(stream.at(-1)).toEqual({ type: "error", code: "aiUnavailable" });
    expect(await db.coachSuggestion.count({ where: { conversationId: id } })).toBe(0);
  });

  it("un utilisateur ne peut ni lire, ni écrire, ni décider dans la conversation d'un autre (404)", async () => {
    asUser(alice);
    const { id } = await coachRepo.createConversation(alice.id, "DISCOVER");
    ai.replies = [call("propose_skill", { name: "Rust" }), "Proposé."];
    const stream = await events(await send(id, { content: "Je code en Rust" }));
    const suggestion = stream.find((e) => e.type === "suggestion");
    if (suggestion?.type !== "suggestion") throw new Error("suggestion attendue");

    asUser(bob);
    expect((await getConversationRoute(new Request("http://test"), params(id))).status).toBe(404);
    expect((await send(id, { content: "Bonjour" })).status).toBe(404);
    expect(await coachRepo.getConversation(bob.id, id)).toBeNull();
    expect(await actions.acceptCoachSuggestion(suggestion.suggestion.id)).toEqual({
      ok: false,
      errors: { _form: "notFound" },
    });
    expect(await actions.rejectCoachSuggestion(suggestion.suggestion.id)).toEqual({
      ok: false,
      errors: { _form: "notFound" },
    });
    await actions.removeConversation(id);
    expect(await db.skill.count({ where: { userId: bob.id } })).toBe(0);
    const bobExport = JSON.parse(await (await exportRoute()).text());
    expect(bobExport.coachConversations).toEqual([]);

    asUser(alice);
    const own = await getConversationRoute(new Request("http://test"), params(id));
    expect(own.status).toBe(200);
    expect((await own.json()).messages).toHaveLength(2);
    const aliceExport = JSON.parse(await (await exportRoute()).text());
    expect(aliceExport.coachConversations.map((c: { id: string }) => c.id)).toContain(id);

    asUser(null);
    expect((await send(id, { content: "x" })).status).toBe(401);
  });

  it("supprime une conversation avec ses messages et suggestions (cascade)", async () => {
    asUser(alice);
    const { id } = await coachRepo.createConversation(alice.id, "DISCOVER");
    ai.replies = [call("propose_skill", { name: "Go" }), "Proposé."];
    await events(await send(id, { content: "Go" }));
    expect(await db.coachSuggestion.count({ where: { conversationId: id } })).toBe(1);
    await actions.removeConversation(id);
    expect(await db.coachConversation.count({ where: { id } })).toBe(0);
    expect(await db.coachMessage.count({ where: { conversationId: id } })).toBe(0);
    expect(await db.coachSuggestion.count({ where: { conversationId: id } })).toBe(0);
  });

  it("limite le nombre de messages par jour (configurable)", async () => {
    asUser(bob);
    process.env.COACH_MESSAGES_PER_DAY = "2";
    const { id } = await coachRepo.createConversation(bob.id, "INTERVIEW");
    ai.replies = ["D'accord."];
    const first = await events(await send(id, { content: "un" }));
    expect(first.at(-1)).toMatchObject({ type: "done", remaining: 1 });
    await events(await send(id, { content: "deux" }));
    const third = await send(id, { content: "trois" });
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: "quotaExceeded", limit: 2 });
    // Le message refusé n'est pas enregistré.
    expect(await db.coachMessage.count({ where: { conversationId: id, role: "USER" } })).toBe(2);
  });

  it("valide le corps de la requête", async () => {
    asUser(alice);
    const { id } = await coachRepo.createConversation(alice.id, "INTERVIEW");
    expect((await send(id, { content: "" })).status).toBe(400);
    expect((await send(id, { content: "x".repeat(5_000) })).status).toBe(400);
    expect((await send(id, { retry: true })).status).toBe(400);
  });
});
