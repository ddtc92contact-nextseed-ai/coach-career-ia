import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});

const { db } = await import("@/lib/db");
const { LEGAL_TERMS_VERSION } = await import("@/config/legal");
const { recordTermsAcceptance } = await import("@/lib/legal/acceptance");
const { createOrganization } = await import("@/lib/employer/repository");

const url = process.env.TEST_DATABASE_URL;
const run = `l${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

describe.skipIf(!url)("acceptation des conditions", () => {
  afterAll(async () => {
    const orgs = await db.organization.findMany({
      where: { domain: { endsWith: `${run}.test` } },
      select: { id: true, companyId: true },
    });
    await db.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
    await db.company.deleteMany({ where: { id: { in: orgs.map((o) => o.companyId) } } });
    await db.user.deleteMany({ where: { email: { endsWith: `${run}.test` } } });
    await db.$disconnect();
  });

  it("la connexion enregistre la version et la date, sans écraser une acceptation à jour", async () => {
    const user = await db.user.create({ data: { email: `candidat@${run}.test` } });
    expect(user.termsVersion).toBeNull();

    const first = new Date("2026-10-08T10:00:00Z");
    expect(await recordTermsAcceptance(user.id, first)).toBe(true);
    expect(await recordTermsAcceptance(user.id, new Date("2026-10-09T10:00:00Z"))).toBe(false);
    const saved = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.termsVersion).toBe(LEGAL_TERMS_VERSION);
    expect(saved.termsAcceptedAt).toEqual(first);

    // Ancienne version acceptée : la nouvelle est enregistrée à la connexion suivante.
    await db.user.update({ where: { id: user.id }, data: { termsVersion: "2020-01-01" } });
    const later = new Date("2026-11-01T10:00:00Z");
    expect(await recordTermsAcceptance(user.id, later)).toBe(true);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.termsVersion).toBe(LEGAL_TERMS_VERSION);
    expect(updated.termsAcceptedAt).toEqual(later);
  });

  it("la création de l'espace entreprise enregistre les conditions entreprises acceptées", async () => {
    const user = await db.user.create({
      data: { email: `rh@acme-${run}.test` },
      select: { id: true, email: true },
    });
    const now = new Date("2026-10-08T12:00:00Z");
    const result = await createOrganization(
      user,
      {
        name: "Acme",
        website: `https://acme-${run}.test`,
        sector: "SAAS_SOFTWARE",
        size: "S51_200",
        country: "FR",
      },
      now,
    );
    expect(result.ok).toBe(true);
    const org = await db.organization.findFirstOrThrow({
      where: { members: { some: { userId: user.id } } },
    });
    expect(org.termsVersion).toBe(LEGAL_TERMS_VERSION);
    expect(org.termsAcceptedAt).toEqual(now);
  });
});
