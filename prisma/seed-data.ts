import type { PrismaClient } from "../src/generated/prisma/client";

export const DEMO_EMAIL = "demo@coach-career.test";

/** Données de démonstration. Idempotent : relançable sans doublons. */
export async function seed(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, emailVerified: new Date() },
  });
}
