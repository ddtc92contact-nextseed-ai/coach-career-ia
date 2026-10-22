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
const { logger } = await import("@/lib/logger");

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
  let carol: { id: string; email: string };
  let dave: { id: string; email: string };
  const fixture = IMPORT_CASES.find((c) => c.id === "linkedin-github-pm")!;
  const cvFixture = IMPORT_CASES.find((c) => c.id === "cv-fr-data-engineer")!;
  const technicien = IMPORT_CASES.find((c) => c.id === "cv-fr-technicien-audiovisuel")!;

  beforeAll(async () => {
    alice = await newUser("import-alice");
    bob = await newUser("import-bob");
    carol = await newUser("import-carol");
    dave = await newUser("import-dave");
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [alice.id, bob.id, carol.id, dave.id] } } });
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

  it("journalise le bilan de l'import sans aucune donnée personnelle", async () => {
    asUser(carol);
    ai.replies = [technicien.llmReply()];
    const info = vi.spyOn(logger, "info");
    const response = await postImport({ cv: new Blob([technicien.sources().cv!.slice()]) });
    const body = await response.json();
    expect(body.result.report.experiences).toMatchObject({ extracted: 5, kept: 5, flagged: 3 });
    const call = info.mock.calls.find(([event]) => event === "import.draft");
    info.mockRestore();
    expect(call?.[1]).toMatchObject({
      experiencesExtracted: 5,
      experiencesKept: 5,
      experiencesFlagged: 3,
      experiencesDropped: 0,
      reasons: "startYearOnly:2,endYearOnly:1,startMissing:1",
      achievementsExtracted: 6,
      achievementsDropped: 0,
      coverageGap: "none",
    });
    const logged = JSON.stringify(call?.[1]).toLowerCase();
    for (const value of [...technicien.forbidden, "technicien", "régisseur", "formateur"]) {
      expect(logged, value).not.toContain(value.toLowerCase());
    }
  });

  it("réimporter son CV sur un profil existant fusionne sans créer de doublons", async () => {
    asUser(carol);
    const { draft } = technicien.expected();
    // Le candidat complète les dates signalées, puis accepte tout.
    const completed = {
      ...draft,
      experiences: draft.experiences.map((e) =>
        e.ref === "exp-4" ? { ...e, startMonth: "2012-09", endMonth: "2019-06" } : e,
      ),
    };
    const first = await saveImport(completed);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.summary).toMatchObject({
      experiences: 5,
      achievements: 6,
      merged: { experiences: 0, achievements: 0 },
    });
    const skillsBefore = await db.skill.count({ where: { userId: carol.id } });

    // Réimportation après correction du CV : mêmes intitulés, périodes qui se
    // chevauchent (mois précisés), une nouvelle période et une nouvelle réalisation.
    const again = {
      experiences: [
        ...completed.experiences.map((e) =>
          e.ref === "exp-1"
            ? {
                ...e,
                roleTitle: "Technicien son et image – intermittent du spectacle",
                startMonth: "2004-11",
              }
            : e.ref === "exp-2"
              ? { ...e, startMonth: "2010-03", endMonth: "2015-11" }
              : e,
        ),
        {
          ...completed.experiences[4]!,
          ref: "exp-6",
          roleTitle: "Opérateur de prise de vue",
          startMonth: "1999-01",
          endMonth: "1999-12",
        },
      ],
      achievements: [
        ...completed.achievements,
        {
          ...completed.achievements[0]!,
          title: "Captation d'un opéra en plein air",
          experienceRef: "exp-1",
        },
      ],
      skills: completed.skills,
    };
    const second = await saveImport(again);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.summary).toMatchObject({
      experiences: 1,
      achievements: 1,
      merged: { experiences: 5, achievements: 6 },
    });
    // Les refs fusionnées pointent vers les expériences existantes (lien avec le coffre).
    expect(second.summary.experienceIds["exp-1"]).toBe(first.summary.experienceIds["exp-1"]);

    const experiences = await repo.listExperiences(carol.id);
    expect(experiences).toHaveLength(6);
    const intermittent = experiences.find((e) => e.id === first.summary.experienceIds["exp-1"])!;
    // Période élargie, poste toujours en cours, saisie existante conservée.
    expect(intermittent.startMonth.toISOString().slice(0, 7)).toBe("2004-11");
    expect(intermittent.endMonth).toBeNull();
    expect(intermittent.roleTitle).toBe(draft.experiences[0]!.roleTitle);
    const missions = experiences.find((e) => e.id === first.summary.experienceIds["exp-2"])!;
    expect(missions.startMonth.toISOString().slice(0, 7)).toBe("2010-01");
    expect(missions.endMonth?.toISOString().slice(0, 7)).toBe("2015-11");

    const achievements = await repo.listAchievements(carol.id);
    expect(achievements).toHaveLength(7);
    expect(new Set(achievements.map((a) => a.title)).size).toBe(7);
    expect(await db.skill.count({ where: { userId: carol.id } })).toBe(skillsBefore);
  });
  it("un premier import garde distincts les postes de même intitulé aux périodes contiguës", async () => {
    asUser(dave);
    const template = technicien.expected().draft.experiences[0]!;
    const stint = (
      ref: string,
      startMonth: string,
      endMonth: string,
      responsibilities: string,
    ) => ({
      ...template,
      ref,
      roleTitle: "Technicien son",
      startMonth,
      endMonth,
      responsibilities,
    });
    const draft = {
      experiences: [
        stint("exp-1", "2000-03", "2005-06", "Tournées en salle"),
        stint("exp-2", "2005-06", "2010-12", "Plateaux télévisés"),
        stint("exp-3", "2008-01", "2012-12", "Festivals d'été"),
      ],
      achievements: ["exp-1", "exp-2"].map((experienceRef) => ({
        ...technicien.expected().draft.achievements[0]!,
        title: "Sonorisation d'un concert",
        experienceRef,
      })),
      skills: [],
    };
    const first = await saveImport(draft);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.summary).toMatchObject({
      experiences: 3,
      achievements: 2,
      merged: { experiences: 0, achievements: 0 },
    });
    expect(new Set(Object.values(first.summary.experienceIds)).size).toBe(3);
    const experiences = await repo.listExperiences(dave.id);
    expect(experiences.map((e) => e.responsibilities).sort()).toEqual([
      "Festivals d'été",
      "Plateaux télévisés",
      "Tournées en salle",
    ]);

    // Réimportation du même CV : chaque poste retrouve le sien, sans doublon.
    const again = await saveImport(draft);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.summary).toMatchObject({
      experiences: 0,
      achievements: 0,
      merged: { experiences: 3, achievements: 2 },
    });
    expect(again.summary.experienceIds).toEqual(first.summary.experienceIds);
    const after = await repo.listExperiences(dave.id);
    expect(after).toHaveLength(3);
    expect(
      after
        .map(
          (e) =>
            `${e.startMonth.toISOString().slice(0, 7)}→${e.endMonth?.toISOString().slice(0, 7)}`,
        )
        .sort(),
    ).toEqual(["2000-03→2005-06", "2005-06→2010-12", "2008-01→2012-12"]);
    expect(await repo.listAchievements(dave.id)).toHaveLength(2);
  });
});
