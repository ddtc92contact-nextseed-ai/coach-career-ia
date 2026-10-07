import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { DEMO_EMAIL, seed } from "../../prisma/seed-data";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("base de données (migrations + seed)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("active l'extension pgvector via une migration", async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
    const [distance] = await prisma.$queryRaw<{ d: number }[]>`
      SELECT ('[1,2,3]'::vector <-> '[1,2,4]'::vector)::float8 AS d`;
    expect(distance?.d).toBe(1);
  });

  it("le seed est idempotent", async () => {
    await seed(prisma);
    await seed(prisma);
    expect(await prisma.user.count({ where: { email: DEMO_EMAIL } })).toBe(1);
  });

  it("supprimer un utilisateur supprime ses sessions (aucune donnée orpheline)", async () => {
    const user = await prisma.user.create({
      data: { email: `cascade-${Date.now()}@exemple.test` },
    });
    await prisma.session.create({
      data: {
        sessionToken: `tok-${Date.now()}`,
        userId: user.id,
        expires: new Date(Date.now() + 60_000),
      },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});
