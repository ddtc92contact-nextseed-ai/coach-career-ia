import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAiClient,
  createMockProvider,
  scriptedReplies,
  AiError,
  type MockReply,
} from "@/lib/ai";
import { createLogger } from "@/lib/logger";
import { IMPORT_CASES } from "../fixtures/import/cases";

// Base de test, session et fournisseur IA simulés : le code applicatif est exécuté tel quel.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const ai = { replies: [] as MockReply[] };
vi.mock("@/lib/ai/server", () => ({
  isAiConfigured: () => true,
  getAiClient: () =>
    createAiClient({
      provider: createMockProvider({ respond: scriptedReplies(...ai.replies) }),
      logger: createLogger({ write: () => {} }),
      sleep: async () => {},
      maxRetries: 0,
    }),
}));

const { db } = await import("@/lib/db");
const { getCurrentUser, requireUser } = await import("@/lib/auth/session");
const repo = await import("@/lib/career/repository");
const { POST: importRoute } = await import("@/app/api/import/route");
const { saveImport } = await import("@/app/[locale]/app/memoire/importer/actions");

const url = process.env.TEST_DATABASE_URL;

async function newUser(label: string) {
  return db.user.create({
    data: { email: `${label}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test` },
  });
}

function asUser(user: { id: string; email: string } | null) {
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  vi.mocked(requireUser).mockImplementation(async () => {
    if (!user) throw new Error("redirection vers la connexion");
    return user;
  });
}

function postImport(fields: Record<string, Blob | string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return importRoute(new Request("http://test/api/import", { method: "POST", body }));
}

describe.skipIf(!url)("import IA : API et enregistrement des éléments validés", () => {
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  const fixture = IMPORT_CASES.find((c) => c.id === "linkedin-github-pm")!;
  const cvFixture = IMPORT_CASES.find((c) => c.id === "cv-fr-data-engineer")!;

  beforeAll(async () => {
    alice = await newUser("import-alice");
    bob = await newUser("import-bob");
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
  });

  it("refuse l'API sans session", async () => {
    asUser(null);
    const response = await postImport({ github: "x" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "unauthorized" });
  });

  it("renvoie le brouillon sans RIEN enregistrer ni conserver", async () => {
    asUser(alice);
    ai.replies = [cvFixture.llmReply()];
    const cv = cvFixture.sources().cv!;
    const response = await postImport({ cv: new Blob([cv.slice()]), github: "" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toEqual({ ok: true, result: cvFixture.expected() });
    // Rien en base tant que le candidat n'a pas validé.
    expect(await db.experience.count({ where: { userId: alice.id } })).toBe(0);
    expect(await db.achievement.count({ where: { userId: alice.id } })).toBe(0);
  });

  it("traduit une panne du fournisseur en code d'erreur affichable", async () => {
    asUser(alice);
    ai.replies = [{ error: new AiError("timeout") }];
    const response = await postImport({ cv: new Blob([cvFixture.sources().cv!.slice()]) });
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ ok: false, error: "aiTimeout" });

    ai.replies = [{ error: new AiError("unavailable", { status: 503 }) }];
    const down = await postImport({ cv: new Blob([cvFixture.sources().cv!.slice()]) });
    expect(await down.json()).toEqual({ ok: false, error: "aiUnavailable" });
  });

  it("refuse un fichier d'un type non pris en charge", async () => {
    asUser(alice);
    const response = await postImport({
      cv: new Blob(["pas un CV, juste du texte brut ".repeat(5)]),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "cvType" });
  });

  it("enregistre les seuls éléments acceptés, avec le bon niveau de preuve", async () => {
    asUser(alice);
    const { draft } = fixture.expected();
    // Le candidat accepte la 1re expérience, deux réalisations (dont une prouvée) et une compétence.
    const accepted = {
      experiences: [draft.experiences[0]!],
      achievements: [draft.achievements[0]!, draft.achievements[2]!],
      skills: [draft.skills[0]!],
    };
    const result = await saveImport(accepted);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({ experiences: 1, achievements: 2, skills: 1 });
    const experienceId = result.summary.experienceIds[draft.experiences[0]!.ref]!;

    const experiences = await repo.listExperiences(alice.id);
    expect(experiences.map((e) => e.id)).toEqual([experienceId]);
    const achievements = await repo.listAchievements(alice.id);
    const launch = achievements.find((a) => a.title === draft.achievements[0]!.title)!;
    const library = achievements.find((a) => a.title === draft.achievements[2]!.title)!;
    expect(launch).toMatchObject({ evidenceLevel: "DECLARED", experienceId });
    expect(launch.skills.map((s) => s.name)).toEqual(["Discovery", "Product Management"]);
    expect(library).toMatchObject({ evidenceLevel: "DOCUMENT", experienceId: null });
    expect(library.proofs).toMatchObject([
      { kind: "URL", url: "https://github.com/hverdier-dev/jours-feries" },
    ]);
    const skills = await repo.listSkills(alice.id);
    expect(skills.map((s) => s.name).sort()).toEqual(
      ["Discovery", "Product Management", "Scrum", "Tests automatisés", "TypeScript"].sort(),
    );
    // Isolation : rien chez Bob.
    expect(await repo.listExperiences(bob.id)).toEqual([]);
  });

  it("revalide le brouillon reçu : rien d'invalide ni de vide n'est enregistré", async () => {
    asUser(bob);
    const invalid = await saveImport({
      experiences: [{ ...fixture.expected().draft.experiences[0]!, sector: "INCONNU" }],
      achievements: [],
      skills: [],
    });
    expect(invalid).toEqual({ ok: false, errors: { "experiences.0.sector": "invalidChoice" } });
    expect(await saveImport({ experiences: [], achievements: [], skills: [] })).toEqual({
      ok: false,
      errors: { _form: "required" },
    });
    expect(await db.experience.count({ where: { userId: bob.id } })).toBe(0);
  });
});
