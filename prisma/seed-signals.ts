import type { PrismaClient } from "../src/generated/prisma/client";
import type { RemotePolicy } from "../src/generated/prisma/enums";
import { addWeeks, weekStart } from "../src/lib/radar/signals/compute";
import { runCompanySignals } from "../src/lib/radar/signals/job";

/**
 * Entreprises de démonstration avec un historique d'offres sur 10 semaines,
 * pour voir les signaux faibles sur /app/radar et sur une opportunité :
 * - Nova Analytics : pic de recrutement, nouvelle équipe data, nouvelle ville ;
 * - Orbit Logistique : recrutement gelé et offre republiée.
 * Les offres portent une clé de source `seed:*` : aucune collecte ne les ferme.
 * Idempotent : rien n'est recréé si les entreprises existent déjà.
 */

type SeedOffer = {
  title: string;
  week: number;
  closedWeek?: number;
  reopenedWeek?: number;
  city?: string;
  remote?: RemotePolicy;
  salary?: [number, number];
  dedupKey?: string;
};

const repeat = (count: number, offer: SeedOffer) => Array.from({ length: count }, () => offer);

/** Recrutement régulier : 5 offres à la première collecte puis une par semaine. */
const steady = (title: string, weeks: number): SeedOffer[] => [
  ...repeat(5, { title, week: 0, closedWeek: 3 }),
  ...Array.from({ length: weeks - 1 }, (_, i) => ({ title, week: i + 1, closedWeek: i + 4 })),
];

const COMPANIES: { slug: string; name: string; sector: string; offers: SeedOffer[] }[] = [
  {
    slug: "demo-nova-analytics",
    name: "Nova Analytics",
    sector: "Logiciel",
    offers: [
      ...steady("Développeur backend", 9),
      ...repeat(5, { title: "Développeur backend", week: 9, salary: [55000, 65000] }),
      { title: "Data scientist", week: 9, salary: [60000, 72000] },
      { title: "Head of Data", week: 9, salary: [90000, 110000] },
      {
        title: "Data engineer senior",
        week: 9,
        city: "Lyon",
        salary: [70000, 80000],
      },
    ],
  },
  {
    slug: "demo-orbit-logistique",
    name: "Orbit Logistique",
    sector: "Logistique",
    offers: [
      ...repeat(6, { title: "Responsable d'entrepôt", week: 0, closedWeek: 8 }),
      ...Array.from({ length: 7 }, (_, i) =>
        repeat(2, { title: "Préparateur de commandes", week: i + 1, closedWeek: i < 4 ? 6 : 9 }),
      ).flat(),
      { title: "Account executive", week: 2, reopenedWeek: 9, remote: "ONSITE" },
    ],
  },
];

export async function seedCompanySignals(prisma: PrismaClient, userId: string): Promise<void> {
  const now = new Date();
  // Semaine 0 = 10 semaines avant la semaine en cours ; semaine 9 = dernière semaine terminée.
  const origin = addWeeks(weekStart(now), -10);
  const at = (week: number, day: number) =>
    new Date(addWeeks(origin, week).getTime() + day * 86_400_000 + 8 * 3_600_000);

  for (const company of COMPANIES) {
    if (await prisma.company.findUnique({ where: { slug: company.slug } })) continue;
    const row = await prisma.company.create({
      data: { slug: company.slug, name: company.name, sector: company.sector, active: false },
    });
    await prisma.jobOffer.createMany({
      data: company.offers.map((o, i) => {
        const id = `${company.slug}-${i + 1}`;
        const closedAt = o.closedWeek === undefined ? null : at(o.closedWeek, 2);
        return {
          source: "greenhouse",
          sourceKey: `seed:${company.slug}`,
          sourceId: id,
          url: `https://example.com/jobs/${id}`,
          urlKey: `example.com/jobs/${id}`,
          dedupKey: o.dedupKey ?? `seed|${id}`,
          title: o.title,
          companyName: company.name,
          companyId: row.id,
          description: `${o.title} chez ${company.name}. CDI, 2 jours de télétravail par semaine.`,
          city: o.city ?? "Paris",
          country: "FR",
          remotePolicy: o.remote ?? "HYBRID",
          contractType: "CDI" as const,
          salaryMin: o.salary?.[0] ?? null,
          salaryMax: o.salary?.[1] ?? null,
          salaryCurrency: o.salary ? "EUR" : null,
          salaryPeriod: o.salary ? ("YEAR" as const) : null,
          sector: company.sector,
          firstSeenAt: at(o.week, 1),
          lastSeenAt: closedAt ?? now,
          closedAt,
          status: closedAt ? ("CLOSED" as const) : ("OPEN" as const),
          reopenedAt: o.reopenedWeek === undefined ? null : at(o.reopenedWeek, 3),
          reopenCount: o.reopenedWeek === undefined ? 0 : 1,
          contentHash: id,
        };
      }),
    });
  }

  await runCompanySignals(prisma);

  // Une opportunité du compte de démonstration chez Nova Analytics : bloc « Dynamique de l'entreprise ».
  const offer = await prisma.jobOffer.findFirst({
    where: { sourceKey: "seed:demo-nova-analytics", title: "Head of Data", status: "OPEN" },
  });
  if (offer) {
    await prisma.match.upsert({
      where: { userId_offerId: { userId, offerId: offer.id } },
      update: {},
      create: {
        userId,
        offerId: offer.id,
        score: 72,
        explanation: {},
        inputHash: "seed",
        computedAt: now,
      },
    });
  }
}
