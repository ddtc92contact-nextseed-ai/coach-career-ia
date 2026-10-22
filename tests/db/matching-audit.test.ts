import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Audit du matching (issue #78) : `npm run matching:audit` sur une base
 * seedée. Il n'écrit rien (mêmes nombres de lignes et mêmes `updated_at`
 * dans TOUTES les tables, avant et après), et sa sortie ne contient aucune
 * donnée identifiante du candidat.
 */

const { Prisma, PrismaClient } = await import("@/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const { assertReadOnly, readOnlyClient, runReadOnlyAudit } = await import("@/lib/matching/audit");
const { experienceEmbeddingText, memoryEmbeddingText, textHash } =
  await import("@/lib/matching/embeddings");
const { DEMO_EMAIL, seed } = await import("../../prisma/seed-data");

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url ?? "postgresql://absent/absent" }),
});
const run = `a${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const email = `Audit-${run}@exemple.test`;
const model = `mock-audit-${run}`;
const env = { MATCHING_SIM_MIN_SAMPLES: "10" };

/** Données du candidat qui ne doivent JAMAIS apparaître dans la sortie. */
const SECRET = {
  achievementTitle: `Refonte zythologique ${run}`,
  context: `Brasserie Lambic-${run} en difficulté`,
  actions: `Recettes réécrites avec Hortense-${run}`,
  result: `Ventes ×3 chez Gueuze-${run}`,
  responsibilities: `Direction de la cave Kriek-${run}, équipe de 4`,
  skill: `Zythologie ${run}`,
};

const MEMORY = { achievement: [1, 0, 0], experience: [0, 1, 0] };
/** Vecteur d'offre de similarité `a` avec la réalisation et `b` avec l'expérience. */
const offerVector = (a: number, b: number) => [a, b, Math.sqrt(Math.max(0, 1 - a * a - b * b))];
const literal = (v: number[]) => `[${v.join(",")}]`;

const OFFERS = [
  ...[0, 1, 2].map((i) => ({
    id: `${run}-metier-${i}`,
    title: `Zythologue confirmé ${i}`,
    description: "Sélection des bières, zythologie et formation des équipes en cave.",
    sim: 0.69 - 0.01 * i,
  })),
  ...Array.from({ length: 30 }, (_, i) => ({
    id: `${run}-autre-${i.toString().padStart(2, "0")}`,
    title: `Comptable fournisseurs ${i}`,
    description: "Saisie des factures, rapprochements bancaires, clôtures mensuelles.",
    sim: 0.3 + 0.01 * i,
  })),
];

/** Nombre de lignes et dernier `updated_at` de chaque table du schéma. */
async function snapshot(): Promise<Record<string, { rows: number; updatedAt: string | null }>> {
  const columns = await db.$queryRaw<{ table: string; hasUpdatedAt: boolean }[]>`
    SELECT t.table_name AS "table",
           EXISTS (SELECT 1 FROM information_schema.columns c
                   WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
                     AND c.column_name = 'updated_at') AS "hasUpdatedAt"
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name`;
  const result: Record<string, { rows: number; updatedAt: string | null }> = {};
  for (const { table, hasUpdatedAt } of columns) {
    const name = Prisma.raw(`"${table.replace(/"/g, '""')}"`);
    const [row] = await db.$queryRaw<{ rows: number; updatedAt: Date | null }[]>`
      SELECT count(*)::int AS rows,
             ${hasUpdatedAt ? Prisma.sql`max(updated_at)` : Prisma.sql`NULL::timestamp`} AS "updatedAt"
      FROM ${name}`;
    result[table] = { rows: row!.rows, updatedAt: row!.updatedAt?.toISOString() ?? null };
  }
  return result;
}

function cli(...args: string[]): string {
  return execFileSync("npx", ["tsx", "scripts/matching-audit.ts", ...args], {
    env: { ...process.env, ...env, DATABASE_URL: url! },
    encoding: "utf8",
  });
}

describe.skipIf(!url)("matching : audit en lecture seule (#78)", { timeout: 180_000 }, () => {
  let userId: string;

  beforeAll(async () => {
    await seed(db);
    const user = await db.user.create({ data: { email: email.toLowerCase() } });
    userId = user.id;
    const experience = await db.experience.create({
      data: {
        userId,
        roleTitle: "Maître zythologue",
        responsibilities: SECRET.responsibilities,
        startMonth: new Date("2015-01-01"),
        seniority: "SENIOR",
        contractType: "CDI",
        sector: "AGRIFOOD",
        companySize: "S11_50",
        companyStage: "SME",
      },
    });
    const skill = await db.skill.create({
      data: { userId, name: SECRET.skill, nameKey: SECRET.skill.toLowerCase() },
    });
    const achievement = await db.achievement.create({
      data: {
        userId,
        experienceId: experience.id,
        title: SECRET.achievementTitle,
        context: SECRET.context,
        actions: SECRET.actions,
        result: SECRET.result,
        evidenceLevel: "DOCUMENT",
        skills: { create: [{ skillId: skill.id }] },
      },
      include: { skills: { include: { skill: true } } },
    });
    await db.guardRails.create({ data: { userId, acceptsOnCall: true } });

    const now = new Date();
    await db.jobOffer.createMany({
      data: OFFERS.map((o) => ({
        id: o.id,
        source: "test-matching-audit",
        sourceKey: `test-matching-audit:${run}`,
        sourceId: o.id,
        url: `https://emplois.exemple.test/${o.id}`,
        urlKey: `emplois.exemple.test/${o.id}`,
        title: o.title,
        description: o.description,
        companyName: "Brasserie Publique",
        latitude: 48.85,
        longitude: 2.35,
        remotePolicy: "ONSITE" as const,
        contractType: "CDI" as const,
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: o.id,
      })),
    });
    for (const o of OFFERS) {
      await db.$executeRaw`
        INSERT INTO offer_embeddings (offer_id, model, text_hash, embedding)
        VALUES (${o.id}, ${model}, ${o.id}, ${literal(offerVector(o.sim, o.sim))}::vector)`;
    }
    // Empreintes des textes embarqués, calculées comme le worker (`loadProfile`).
    const achievementText = [
      achievement.title,
      achievement.context,
      achievement.actions,
      achievement.result,
      achievement.skills.map((s) => s.skill.name).join(", "),
    ].join("\n");
    const hashes = {
      achievement: textHash(memoryEmbeddingText(achievementText)),
      experience: textHash(
        memoryEmbeddingText(
          experienceEmbeddingText({
            title: experience.roleTitle,
            responsibilities: experience.responsibilities,
          }),
        ),
      ),
    };
    for (const kind of ["achievement", "experience"] as const) {
      await db.$executeRaw`
        INSERT INTO memory_embeddings (user_id, model, text_hash, embedding)
        VALUES (${userId}, ${model}, ${hashes[kind]}, ${literal(MEMORY[kind])}::vector)`;
    }
    await db.match.create({
      data: {
        userId,
        offerId: OFFERS[0]!.id,
        score: 77,
        explanation: {},
        inputHash: "x",
        computedAt: now,
      },
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: email.toLowerCase() } });
    await db.jobOffer.deleteMany({ where: { id: { startsWith: run } } });
    await db.$disconnect();
  });

  it("`npm run matching:audit` produit le texte et le JSON sans rien écrire", async () => {
    const before = await snapshot();
    const text = cli(email, "--model", model);
    const json = JSON.parse(cli(userId, "--json", "--model", model));
    const demo = cli(DEMO_EMAIL);
    expect(await snapshot()).toEqual(before);

    expect(text).toContain(`candidat ${userId}`);
    expect(text).toContain("Top 30");
    expect(text).toMatch(/Zythologue confirmé 0 — Brasserie Publique/);
    expect(demo).toContain("Audit du matching");
    expect(json).toMatchObject({ version: 1, userId, eligible: true });
  });

  it("rejoue le score : distribution par élément, plage calibrée, top et termes métier", async () => {
    const report = await runReadOnlyAudit(url!, email, { model, env });
    expect(report.memory).toHaveLength(2);
    for (const item of report.memory) {
      expect(item).toMatchObject({ embedded: true, offers: OFFERS.length, calibrated: true });
      expect(item.fingerprint).toMatch(/^[0-9a-f]{8}$/);
      expect(item.max).toBeCloseTo(0.69, 3);
      expect(item.median).toBeLessThan(item.p90!);
      expect(item.p90).toBeLessThanOrEqual(item.p99!);
      expect(item.range.floor).toBeCloseTo(item.median!, 3);
    }
    expect(report.offers.withoutEmbedding).toBe(report.offers.passing - OFFERS.length);
    expect(report.top.slice(0, 3).map((t) => t.offerId)).toEqual(
      OFFERS.slice(0, 3).map((o) => o.id),
    );
    expect(report.top[0]).toMatchObject({ rank: 1, lexical: true, businessTerm: true });
    expect(report.top[0]!.gate).toBe(1);
    const other = report.top.find((t) => t.offerId.startsWith(`${run}-autre`))!;
    expect(other).toMatchObject({ lexical: false, businessTerm: false, requirement: false });
    expect(report.topBusinessTermShare).toBeGreaterThan(0);
    expect(report.scores.total.count).toBe(report.offers.passing);
    expect(report.stored.total).toMatchObject({ count: 1, max: 77 });
  });

  it("aucune donnée identifiante : ni e-mail, ni texte de réalisation, ni compétence", async () => {
    const outputs = [
      cli(email, "--model", model),
      cli(email, "--json", "--model", model),
      cli(DEMO_EMAIL),
      cli(DEMO_EMAIL, "--json"),
    ];
    const demo = await db.user.findUniqueOrThrow({
      where: { email: DEMO_EMAIL },
      include: { achievements: true, experiences: true, skills: true },
    });
    const forbidden = [
      email,
      email.toLowerCase(),
      DEMO_EMAIL,
      ...Object.values(SECRET),
      ...demo.achievements.flatMap((a) => [a.title, a.context, a.actions, a.result]),
      ...demo.experiences.map((e) => e.responsibilities),
      ...demo.skills.map((s) => s.name),
    ].filter((value) => value.trim().length > 0);
    for (const output of outputs) {
      for (const value of forbidden) expect(output).not.toContain(value);
      expect(output).not.toMatch(/@/);
    }
  });

  it("la session d'audit refuse toute écriture", async () => {
    const readOnly = readOnlyClient(url!);
    try {
      await assertReadOnly(readOnly);
      await expect(
        readOnly.user.create({ data: { email: `ecriture-${run}@exemple.test` } }),
      ).rejects.toThrow(/read-only/);
    } finally {
      await readOnly.$disconnect();
    }
    await expect(assertReadOnly(db)).rejects.toThrow(/lecture seule/);
  });

  it("candidat inconnu : code de sortie 2, sans rapport", () => {
    expect(() => cli(`inconnu-${run}@exemple.test`)).toThrow();
  });
});
