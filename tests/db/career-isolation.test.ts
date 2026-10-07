import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Base de test et session simulée : le code applicatif est exécuté tel quel.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

const { db } = await import("@/lib/db");
const { getCurrentUser } = await import("@/lib/auth/session");
const repo = await import("@/lib/career/repository");
const { GET: downloadProof } = await import("@/app/api/proofs/[id]/route");
const { GET: exportRoute } = await import("@/app/api/account/export/route");

const PDF = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.from("Attestation confidentielle 42"),
]);
const url = process.env.TEST_DATABASE_URL;

const experience = {
  roleTitle: "Responsable data",
  startMonth: "2020-01",
  endMonth: undefined,
  seniority: "LEAD",
  contractType: "CDI",
  sector: "FINTECH",
  companySize: "S201_500",
  companyStage: "SCALEUP",
  responsibilities: "Équipe de 5 personnes",
} as const;

const achievement = (experienceId?: string) => ({
  title: "Pipeline de scoring",
  context: "Fraude en hausse",
  actions: "Conception du modèle",
  result: "-30 % de fraude",
  skills: ["Python", "SQL"],
  experienceId,
});

async function newUser(label: string) {
  return db.user.create({
    data: { email: `${label}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test` },
  });
}

function asUser(user: { id: string; email: string } | null) {
  vi.mocked(getCurrentUser).mockResolvedValue(user);
}

function download(proofId: string) {
  return downloadProof(new Request(`http://test/api/proofs/${proofId}`), {
    params: Promise.resolve({ id: proofId }),
  });
}

describe.skipIf(!url)("mémoire de carrière : isolation, export et suppression", () => {
  let uploadDir: string;
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let aliceExperienceId: string;
  let aliceAchievementId: string;
  let aliceDocumentId: string;
  let aliceUrlProofId: string;
  let aliceSkillId: string;

  beforeAll(async () => {
    process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    uploadDir = await mkdtemp(path.join(tmpdir(), "ccia-uploads-"));
    process.env.UPLOAD_DIR = uploadDir;

    alice = await newUser("alice");
    bob = await newUser("bob");

    aliceExperienceId = (await repo.createExperience(alice.id, experience)).id;
    aliceAchievementId = (await repo.createAchievement(alice.id, achievement(aliceExperienceId)))
      .id;
    await repo.addTextProof(alice.id, aliceAchievementId, {
      kind: "URL",
      url: "https://exemple.fr/etude",
    });
    const upload = await repo.addDocumentProof(alice.id, aliceAchievementId, {
      name: "Attestation Alice Martin.pdf",
      bytes: PDF,
    });
    if (!upload.ok) throw new Error(upload.error);
    aliceDocumentId = upload.proofId;
    const achievementView = await repo.getAchievement(alice.id, aliceAchievementId);
    aliceUrlProofId = achievementView!.proofs.find((p) => p.kind === "URL")!.id;
    await repo.addDeclaredSkill(alice.id, "Négociation");
    aliceSkillId = (await repo.listSkills(alice.id)).find((s) => s.name === "Négociation")!.id;
    await repo.saveGuardRails(alice.id, {
      minFixedSalary: 60000,
      targetTotalPackage: 70000,
      remotePolicy: "HYBRID",
      minRemoteDays: 2,
      contractTypes: ["CDI"],
      excludedSectors: ["GAMBLING"],
      excludedCompanies: ["Globex Corporation"],
      maxWeeklyHours: 40,
      acceptsOnCall: false,
      culturePreferences: ["ASYNC_FIRST"],
      locations: [{ label: "Nantes", radiusKm: 25 }],
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [alice?.id, bob?.id].filter(Boolean) } } });
    await rm(uploadDir, { recursive: true, force: true });
    await db.$disconnect();
  });

  it("calcule le niveau de preuve et les compétences à partir des réalisations", async () => {
    const view = await repo.getAchievement(alice.id, aliceAchievementId);
    expect(view?.evidenceLevel).toBe("DOCUMENT");
    expect(view?.proofs.find((p) => p.kind === "DOCUMENT")?.fileName).toBe(
      "Attestation Alice Martin.pdf",
    );
    const skills = await repo.listSkills(alice.id);
    expect(skills.find((s) => s.name === "Python")).toMatchObject({
      level: "DEMONSTRATED",
      current: true,
      achievements: [{ id: aliceAchievementId, proofCount: 2 }],
    });
    expect(skills.find((s) => s.name === "Négociation")?.level).toBe("UNPROVEN");
  });

  it("B ne voit aucun élément de A", async () => {
    expect(await repo.listExperiences(bob.id)).toEqual([]);
    expect(await repo.listAchievements(bob.id)).toEqual([]);
    expect(await repo.listSkills(bob.id)).toEqual([]);
    expect(await repo.getExperience(bob.id, aliceExperienceId)).toBeNull();
    expect(await repo.getAchievement(bob.id, aliceAchievementId)).toBeNull();
    expect(await repo.getProofDocument(bob.id, aliceDocumentId)).toBeNull();
    expect((await repo.getGuardRails(bob.id)).excludedCompanies).toEqual([]);
  });

  it("B ne peut ni modifier ni supprimer les éléments de A", async () => {
    const { NotFoundError } = repo;
    await expect(repo.updateExperience(bob.id, aliceExperienceId, experience)).rejects.toThrow(
      NotFoundError,
    );
    await expect(repo.deleteExperience(bob.id, aliceExperienceId)).rejects.toThrow(NotFoundError);
    await expect(repo.updateAchievement(bob.id, aliceAchievementId, achievement())).rejects.toThrow(
      NotFoundError,
    );
    await expect(repo.deleteAchievement(bob.id, aliceAchievementId)).rejects.toThrow(NotFoundError);
    await expect(
      repo.addTextProof(bob.id, aliceAchievementId, { kind: "URL", url: "https://pirate.example" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      repo.addDocumentProof(bob.id, aliceAchievementId, { name: "x.pdf", bytes: PDF }),
    ).rejects.toThrow(NotFoundError);
    await expect(repo.deleteProof(bob.id, aliceUrlProofId)).rejects.toThrow(NotFoundError);
    await expect(repo.deleteProof(bob.id, aliceDocumentId)).rejects.toThrow(NotFoundError);
    await expect(repo.deleteSkill(bob.id, aliceSkillId)).rejects.toThrow(NotFoundError);
    // Rattacher sa réalisation à l'expérience de A est refusé.
    await expect(repo.createAchievement(bob.id, achievement(aliceExperienceId))).rejects.toThrow(
      NotFoundError,
    );

    // Les données de A sont intactes.
    const view = await repo.getAchievement(alice.id, aliceAchievementId);
    expect(view?.title).toBe("Pipeline de scoring");
    expect(view?.proofs).toHaveLength(2);
    expect(await repo.getExperience(alice.id, aliceExperienceId)).not.toBeNull();
    expect((await repo.listSkills(alice.id)).some((s) => s.id === aliceSkillId)).toBe(true);
  });

  it("le lien de téléchargement d'un document est réservé à son propriétaire", async () => {
    asUser(null);
    expect((await download(aliceDocumentId)).status).toBe(401);

    asUser(bob);
    const forbidden = await download(aliceDocumentId);
    expect(forbidden.status).toBe(404);
    expect(await forbidden.text()).toBe("");

    asUser(alice);
    const ok = await download(aliceDocumentId);
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer()).equals(PDF)).toBe(true);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("content-disposition")).toContain(
      'attachment; filename="Attestation_Alice_Martin.pdf"',
    );
  });

  it("stocke les documents chiffrés, hors de tout dossier public", async () => {
    const files = await readdir(path.join(uploadDir, alice.id));
    expect(files).toHaveLength(1);
    const raw = await readFile(path.join(uploadDir, alice.id, files[0]!));
    expect(raw.includes(Buffer.from("Attestation confidentielle"))).toBe(false);
  });

  it("refuse les fichiers trop lourds ou d'un type non accepté", async () => {
    expect(
      await repo.addDocumentProof(alice.id, aliceAchievementId, {
        name: "page.html",
        bytes: Buffer.from("<html></html>"),
      }),
    ).toEqual({ ok: false, error: "fileType" });
    expect(
      await repo.addDocumentProof(alice.id, aliceAchievementId, {
        name: "gros.pdf",
        bytes: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]),
      }),
    ).toEqual({ ok: false, error: "fileTooLarge" });
  });

  it("chiffre les entreprises exclues en base", async () => {
    const [row] = await db.$queryRaw<{ excluded: string[] }[]>`
      SELECT excluded_companies_enc AS excluded FROM guard_rails WHERE user_id = ${alice.id}`;
    expect(row?.excluded).toHaveLength(1);
    expect(row?.excluded[0]).toMatch(/^v\d+:/);
    expect(row?.excluded[0]).not.toContain("Globex");
    expect((await repo.getGuardRails(alice.id)).excludedCompanies).toEqual(["Globex Corporation"]);
  });

  it("aucune table de la mémoire de carrière n'a de champ nominatif ou de coordonnées", async () => {
    const columns = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (
        'career_profiles', 'experiences', 'achievements', 'proofs', 'skills',
        'achievement_skills', 'guard_rails', 'guard_rail_locations')`;
    expect(columns.length).toBeGreaterThan(30);
    const forbidden = columns.filter(({ column_name }) =>
      /employer|company_name|first_name|last_name|full_name|person|phone|email|address|contact/.test(
        column_name,
      ),
    );
    expect(forbidden).toEqual([]);
  });

  it("l'export contient toutes les données de l'utilisateur, et seulement les siennes", async () => {
    asUser(alice);
    const response = await exportRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const data = JSON.parse(await response.text());
    expect(data.account.email).toBe(alice.email);
    expect(data.experiences).toHaveLength(1);
    expect(data.experiences[0].userId).toBeUndefined();
    expect(data.achievements).toHaveLength(1);
    const document = data.achievements[0].proofs.find(
      (p: { kind: string }) => p.kind === "DOCUMENT",
    );
    expect(Buffer.from(document.contentBase64, "base64").equals(PDF)).toBe(true);
    expect(data.skills.map((s: { name: string }) => s.name).sort()).toEqual([
      "Négociation",
      "Python",
      "SQL",
    ]);
    expect(data.guardRails).toMatchObject({
      minFixedSalary: 60000,
      excludedCompanies: ["Globex Corporation"],
      locations: [{ label: "Nantes", radiusKm: 25 }],
    });

    asUser(bob);
    const bobExport = JSON.parse(await (await exportRoute()).text());
    expect(bobExport.account.email).toBe(bob.email);
    expect(bobExport.experiences).toEqual([]);
    expect(bobExport.achievements).toEqual([]);
  });

  it("supprimer une preuve document efface le fichier et recalcule le niveau de preuve", async () => {
    const extra = (await repo.createAchievement(alice.id, achievement())).id;
    const upload = await repo.addDocumentProof(alice.id, extra, { name: "b.pdf", bytes: PDF });
    if (!upload.ok) throw new Error(upload.error);
    expect((await readdir(path.join(uploadDir, alice.id))).length).toBe(2);
    await repo.deleteProof(alice.id, upload.proofId);
    expect((await readdir(path.join(uploadDir, alice.id))).length).toBe(1);
    expect((await repo.getAchievement(alice.id, extra))?.evidenceLevel).toBe("DECLARED");
    await repo.deleteAchievement(alice.id, extra);
  });

  it("la suppression du compte efface toutes ses données et tous ses fichiers", async () => {
    await repo.deleteAccount(alice.id);

    expect(await db.user.findUnique({ where: { id: alice.id } })).toBeNull();
    const where = { userId: alice.id };
    expect(
      await Promise.all([
        db.experience.count({ where }),
        db.achievement.count({ where }),
        db.proof.count({ where }),
        db.skill.count({ where }),
        db.guardRails.count({ where }),
        db.guardRailLocation.count({ where }),
        db.careerProfile.count({ where }),
        db.session.count({ where }),
      ]),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(existsSync(path.join(uploadDir, alice.id))).toBe(false);
    // B n'est pas affecté.
    expect(await db.user.findUnique({ where: { id: bob.id } })).not.toBeNull();
  });
});
