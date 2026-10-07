import type { PrismaClient } from "../src/generated/prisma/client";

export const DEMO_EMAIL = "demo@coach-career.test";

/** Données de démonstration. Idempotent : relançable sans doublons. */
export async function seed(prisma: PrismaClient): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, emailVerified: new Date(), locale: "fr" },
  });

  // Mémoire de carrière d'exemple, créée une seule fois.
  if ((await prisma.experience.count({ where: { userId: user.id } })) > 0) return;
  const experience = await prisma.experience.create({
    data: {
      userId: user.id,
      roleTitle: "Product manager",
      startMonth: new Date("2021-03-01T00:00:00.000Z"),
      seniority: "SENIOR",
      contractType: "CDI",
      sector: "FINTECH",
      companySize: "S51_200",
      companyStage: "SCALEUP",
      responsibilities: "Parcours de paiement et d'inscription, équipe de 6 personnes.",
    },
  });
  const skill = await prisma.skill.create({
    data: { userId: user.id, name: "Discovery produit", nameKey: "discovery produit" },
  });
  await prisma.achievement.create({
    data: {
      userId: user.id,
      experienceId: experience.id,
      title: "Refonte du parcours d'inscription",
      context: "40 % d'abandon à l'étape de vérification d'identité.",
      actions: "Entretiens utilisateurs, nouveau parcours en 3 étapes, tests A/B.",
      result: "Taux d'abandon divisé par deux en trois mois.",
      evidenceLevel: "DOCUMENT",
      proofs: {
        create: { userId: user.id, kind: "URL", url: "https://example.com/etude-de-cas" },
      },
      skills: { create: { skillId: skill.id } },
    },
  });
  await prisma.guardRails.create({
    data: {
      userId: user.id,
      minFixedSalary: 65000,
      remotePolicy: "HYBRID",
      minRemoteDays: 2,
      contractTypes: ["CDI"],
      excludedSectors: ["GAMBLING"],
    },
  });
}
