import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { loadCompanyConfig } from "@/lib/radar/companies";

const url = process.env.TEST_DATABASE_URL;
const run = Date.now().toString(36);

/** `npm run db:seed` tel qu'au déploiement (production : liste de référence seule). */
function seed(): string {
  return execFileSync("npx", ["tsx", "prisma/seed.ts"], {
    env: { ...process.env, DATABASE_URL: url!, NODE_ENV: "production" },
    encoding: "utf8",
  });
}

describe.skipIf(!url)("seed de la liste de référence du radar", () => {
  let prisma: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await prisma.jobOffer.deleteMany({});
    await prisma.company.deleteMany({});
    userId = (await prisma.user.create({ data: { email: `seed-${run}@exemple.test` } })).id;
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { id: userId } });
    await prisma?.company.deleteMany({});
    await prisma?.$disconnect();
  });

  it("idempotent : rejoué, il ne duplique rien et garde les entreprises ajoutées par les candidats", async () => {
    const reference = await loadCompanyConfig("config/radar-companies.json");
    // Entreprises ajoutées par des candidats avant le déploiement : l'une suivie,
    // l'autre délaissée, la troisième sur un board qui entre dans la liste de référence.
    const followed = await prisma.company.create({
      data: {
        slug: `greenhouse-ajout-${run}`,
        name: "Ajout candidat",
        atsType: "GREENHOUSE",
        boardToken: `ajout-${run}`,
        origin: "USER",
        followers: { create: { userId } },
      },
    });
    const orphan = await prisma.company.create({
      data: {
        slug: `lever-orphelin-${run}`,
        name: "Orphelin",
        atsType: "LEVER",
        boardToken: `orphelin-${run}`,
        origin: "USER",
        active: false,
      },
    });
    const first = reference[0]!;
    const atsType = first.ats.toUpperCase() as "GREENHOUSE";
    const merged = await prisma.company.create({
      data: {
        slug: `ajout-${first.slug}-${run}`,
        name: first.name,
        atsType,
        boardToken: first.boardToken,
        origin: "USER",
        followers: { create: { userId } },
      },
    });

    expect(seed()).toContain(`${reference.length} entreprises de référence importées`);
    const after = await prisma.company.findMany({ orderBy: { slug: "asc" } });
    seed();
    const again = await prisma.company.findMany({ orderBy: { slug: "asc" } });

    // Rien de dupliqué : mêmes lignes, mêmes identifiants, d'un passage à l'autre.
    expect(again.map((c) => [c.id, c.slug, c.origin, c.active])).toEqual(
      after.map((c) => [c.id, c.slug, c.origin, c.active]),
    );
    expect(again.filter((c) => c.origin === "CONFIG")).toHaveLength(reference.length);
    expect(again).toHaveLength(reference.length + 2);
    expect(new Set(again.map((c) => `${c.atsType}:${c.boardToken}`)).size).toBe(again.length);

    // Les ajouts des candidats survivent, avec leurs abonnés.
    expect(again.find((c) => c.id === followed.id)).toMatchObject({
      origin: "USER",
      active: true,
    });
    expect(again.find((c) => c.id === orphan.id)).toMatchObject({ origin: "USER" });
    // Le board désormais dans la liste de référence est rattaché, pas dupliqué.
    expect(again.find((c) => c.id === merged.id)).toMatchObject({
      slug: first.slug,
      origin: "CONFIG",
    });
    expect(await prisma.followedCompany.count({ where: { userId } })).toBe(2);
    // Chaque entrée garde son secteur (exclusions par secteur des garde-fous).
    expect(again.filter((c) => c.origin === "CONFIG" && !c.sector)).toEqual([]);
  }, 60_000);
});
