/**
 * `npm run matching:load` — test de charge mémoire du recalcul du matching
 * (issue #64). Sur une base de TEST (`LOAD_DATABASE_URL`, sinon
 * `TEST_DATABASE_URL` ; jamais `DATABASE_URL`) :
 * 1. insère N offres ouvertes (20 000 par défaut) aux descriptions réalistes
 *    de 5 à 15 ko, et deux candidats (garde-fous larges / garde-fous courants) ;
 * 2. lance chaque recalcul dans un processus Node séparé, avec un tas limité
 *    (`--max-old-space-size`, 288 Mo par défaut), et relève le pic du tas V8,
 *    la RSS maximale et le tas vivant après chaque candidat (plusieurs
 *    candidats enchaînés : rien ne doit rester en mémoire de l'un à l'autre) ;
 * 3. supprime tout ce qu'il a inséré.
 * Aucun appel réseau : IA simulée (embeddings déterministes de 1 024
 * dimensions, comme mistral-embed ; explications simulées).
 *
 *   npm run matching:load -- --offers 20000 --heap-mb 288
 *
 * Code de sortie 1 si un recalcul échoue (tas saturé compris).
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const SOURCE = "load-matching";
const PROFILES = ["broad", "typical"] as const;
type Profile = (typeof PROFILES)[number];

function databaseUrl(): string {
  const url = process.env.LOAD_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("LOAD_DATABASE_URL ou TEST_DATABASE_URL est requis (base de test)");
  if (url === process.env.DATABASE_URL) {
    throw new Error("La base de charge doit être distincte de DATABASE_URL.");
  }
  return url;
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} invalide`);
  return value;
}

// --- Données synthétiques (déterministes) ---------------------------------

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SENTENCES = [
  "Au sein de l’équipe Data, vous concevez et maintenez des pipelines de données fiables.",
  "Vous travaillez avec Python, SQL et Airflow sur une plateforme cloud moderne.",
  "Nous sommes une scale-up en forte croissance, présente dans 12 pays européens.",
  "Télétravail : 2 jours par semaine, bureaux en plein cœur de Paris.",
  "Vous participez aux rituels agiles et à l’amélioration continue de nos pratiques.",
  "Expérience de 5 ans minimum sur un poste similaire, idéalement en environnement SaaS.",
  "Maîtrise de dbt, Spark ou Kafka appréciée ; curiosité et rigueur indispensables.",
  "Avantages : mutuelle prise en charge à 100 %, tickets restaurant, budget formation.",
  "Our engineering culture is async-first, with written RFCs and thoughtful code reviews.",
  "You will collaborate with product managers, designers and data scientists every day.",
  "Le poste est basé à Lyon, avec des déplacements ponctuels à Paris.",
  "Rémunération selon profil, participation et intéressement en complément du fixe.",
  "Vous accompagnez la montée en compétences des profils juniors de l’équipe.",
  "Nous valorisons l’apprentissage continu : conférences, formations, temps dédié à la veille.",
  "Mission : fiabiliser l’ingestion de plusieurs téraoctets de données par jour.",
  "• Concevoir des modèles de données robustes et documentés",
  "• Mettre en place la supervision et l’alerting des traitements",
  "• Optimiser les coûts d’infrastructure et les temps de calcul",
  "Processus de recrutement : un échange RH, un entretien technique, une rencontre d’équipe.",
  "Diversity matters: we welcome applications from all backgrounds and experiences.",
  "Environnement technique : PostgreSQL, Kubernetes, Terraform, GitLab CI, Grafana.",
  "Vous êtes force de proposition sur l’architecture et les choix d’outillage.",
  "Contrat à durée indéterminée, statut cadre, 39 heures hebdomadaires avec RTT.",
  "La qualité des données est au cœur de nos priorités et de notre feuille de route.",
];

const CITIES = [
  { city: "Paris", latitude: 48.8566, longitude: 2.3522, weight: 0.45 },
  { city: "Lyon", latitude: 45.764, longitude: 4.8357, weight: 0.15 },
  { city: "Nantes", latitude: 47.2184, longitude: -1.5536, weight: 0.1 },
  { city: "Lille", latitude: 50.6292, longitude: 3.0573, weight: 0.1 },
  { city: "Toulouse", latitude: 43.6047, longitude: 1.4442, weight: 0.1 },
  { city: null, latitude: null, longitude: null, weight: 0.1 },
] as const;

const TITLES = [
  "Data Engineer",
  "Senior Data Engineer",
  "Analytics Engineer",
  "Développeur Backend Python",
  "Ingénieur Plateforme Data",
  "Lead Data Engineer",
  "Data Analyst confirmé",
  "Ingénieur DevOps",
];

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function description(random: () => number): string {
  const target = 5_000 + Math.floor(random() * 10_000);
  const parts: string[] = [];
  let length = 0;
  while (length < target) {
    const sentence = pick(random, SENTENCES);
    parts.push(sentence);
    length += sentence.length + 1;
  }
  return parts.join(random() < 0.5 ? "\n" : " ");
}

function offer(run: string, index: number) {
  const random = rng(index + 1);
  let roll = random();
  const place = CITIES.find((c) => (roll -= c.weight) < 0) ?? CITIES[0];
  const salaried = random() < 0.5;
  const now = new Date();
  const id = `${run}-${index.toString().padStart(6, "0")}`;
  return {
    id,
    source: SOURCE,
    sourceKey: `${SOURCE}:${run}`,
    sourceId: id,
    url: `https://emplois.exemple.test/${id}`,
    urlKey: `emplois.exemple.test/${id}`,
    title: pick(random, TITLES),
    description: description(random),
    companyName: `Entreprise ${index % 500}`,
    sector: pick(random, ["Logiciel", "Banque", "Santé", "Énergie", null]),
    city: place.city,
    country: "FR",
    latitude: place.latitude,
    longitude: place.longitude,
    remotePolicy: pick(random, ["ONSITE", "HYBRID", "FULL_REMOTE", "UNKNOWN"] as const),
    contractType: pick(random, ["CDI", "CDI", "CDD", "FREELANCE", "UNKNOWN"] as const),
    salaryMin: salaried ? 40_000 + Math.floor(random() * 30) * 1_000 : null,
    salaryMax: salaried ? 60_000 + Math.floor(random() * 30) * 1_000 : null,
    salaryCurrency: salaried ? "EUR" : null,
    salaryPeriod: salaried ? ("YEAR" as const) : null,
    firstSeenAt: now,
    lastSeenAt: now,
    contentHash: id,
  };
}

async function seed(prisma: PrismaClient, run: string, count: number) {
  const CHUNK = 250;
  for (let i = 0; i < count; i += CHUNK) {
    const data = [];
    for (let j = i; j < Math.min(count, i + CHUNK); j++) data.push(offer(run, j));
    await prisma.jobOffer.createMany({ data });
  }

  const users: Record<Profile, string> = { broad: "", typical: "" };
  for (const profile of PROFILES) {
    const user = await prisma.user.create({
      data: { email: `${profile}-${run}@charge.exemple.test`, locale: "fr" },
    });
    users[profile] = user.id;
    await prisma.experience.create({
      data: {
        userId: user.id,
        roleTitle: "Data engineer",
        startMonth: new Date("2018-01-01"),
        seniority: "SENIOR",
        contractType: "CDI",
        sector: "SAAS_SOFTWARE",
        companySize: "S201_500",
        companyStage: "SCALEUP",
      },
    });
    const skills = await Promise.all(
      ["Python", "SQL", "Airflow", "dbt", "Kafka", "Terraform"].map((name) =>
        prisma.skill.create({ data: { userId: user.id, name, nameKey: name.toLowerCase() } }),
      ),
    );
    for (let k = 0; k < 4; k++) {
      await prisma.achievement.create({
        data: {
          userId: user.id,
          title: `Réalisation ${k + 1} : refonte des pipelines de données`,
          context: "Traitements fragiles et coûteux",
          actions: "Migration des traitements Python et SQL vers Airflow, supervision",
          result: "Temps de calcul divisé par trois",
          evidenceLevel: k % 2 === 0 ? "DOCUMENT" : "DECLARED",
          skills: { create: skills.slice(k, k + 3).map((s) => ({ skillId: s.id })) },
        },
      });
    }
    await prisma.guardRails.create({
      data:
        profile === "broad"
          ? // Garde-fous larges : (presque) toutes les offres passent — pire cas mémoire.
            { userId: user.id, remotePolicy: "ONSITE", acceptsOnCall: true }
          : {
              userId: user.id,
              minFixedSalary: 50_000,
              targetTotalPackage: 65_000,
              remotePolicy: "HYBRID",
              minRemoteDays: 2,
              contractTypes: ["CDI"],
              maxWeeklyHours: 39,
              culturePreferences: ["ASYNC_FIRST", "LEARNING_CULTURE"],
            },
    });
    if (profile === "typical") {
      await prisma.guardRailLocation.create({
        data: {
          userId: user.id,
          label: "Paris",
          radiusKm: 30,
          latitude: 48.8566,
          longitude: 2.3522,
        },
      });
    }
  }
  return users;
}

async function cleanup(prisma: PrismaClient, run: string) {
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@charge.exemple.test` } } });
  await prisma.jobOffer.deleteMany({ where: { sourceKey: `${SOURCE}:${run}` } });
}

// --- Mesure (processus enfant) ---------------------------------------------

type Measure = {
  profile: string;
  ok: boolean;
  durationMs: number;
  heapPeakMb: number;
  rssPeakMb: number;
  /** Tas vivant (après GC) à la fin de chaque candidat : il ne doit pas croître. */
  liveMb?: number[];
  summary?: unknown;
  error?: string;
};

async function measure(userIds: string[], profile: string): Promise<Measure> {
  const { createAiClient, createMockProvider, mockEmbedding } = await import("../src/lib/ai");
  const { createLogger } = await import("../src/lib/logger");
  const { matchingConfig } = await import("../src/lib/matching/config");
  const { recomputeUserMatches } = await import("../src/lib/matching/recompute");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
  // Le fournisseur simulé garde chaque texte embarqué (assertions des tests) :
  // ici, embeddings sans mémorisation, comme un vrai fournisseur.
  const mock = createMockProvider();
  const client = createAiClient({
    provider: {
      ...mock,
      embed: async (texts) => ({
        vectors: texts.map((text) => mockEmbedding(text, 1024)),
        usage: { inputTokens: 0, outputTokens: 0 },
        model: "mock-embed",
      }),
    },
    sleep: async () => {},
    backoffMs: 0,
  });

  // Échantillonnage du tas : en continu, et à chaque lot (les requêtes rendent la main).
  let heapPeak = process.memoryUsage().heapUsed;
  const sample = () => {
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
  };
  const timer = setInterval(sample, 5);
  const started = Date.now();
  const logger = createLogger({
    write: (_level, line) => {
      sample();
      process.stderr.write(`${line}\n`);
    },
  });
  const gc = (globalThis as { gc?: () => void }).gc;
  const liveMb: number[] = [];
  try {
    // Comme `runMatchingCycle` : candidats l'un après l'autre, budget LLM partagé.
    const llmBudget = { remaining: 30 };
    let summary: unknown;
    for (const userId of userIds) {
      summary = await recomputeUserMatches(prisma, userId, {
        config: matchingConfig({}),
        client,
        llmBudget,
        logger,
      });
      sample();
      gc?.();
      liveMb.push(Math.round(process.memoryUsage().heapUsed / 1_048_576));
    }
    return {
      profile,
      ok: true,
      durationMs: Date.now() - started,
      heapPeakMb: Math.round(heapPeak / 1_048_576),
      rssPeakMb: Math.round(process.resourceUsage().maxRSS / 1024),
      liveMb,
      summary,
    };
  } finally {
    clearInterval(timer);
    await prisma.$disconnect();
  }
}

// --- Orchestration ------------------------------------------------------------

async function main(): Promise<number> {
  if (process.argv[2] === "--cleanup") {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
    await cleanup(prisma, process.argv[3]!);
    await prisma.$disconnect();
    return 0;
  }
  if (process.argv[2] === "--measure") {
    const result = await measure(process.argv[3]!.split(","), process.argv[4]!);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }

  const offers = arg("offers", 20_000);
  const heapMb = arg("heap-mb", 288);
  const run = `load${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
  const results: Measure[] = [];
  try {
    console.log(`Insertion de ${offers} offres (${run})…`);
    const users = await seed(prisma, run, offers);
    const open = await prisma.jobOffer.count({ where: { status: "OPEN", duplicateOfId: null } });
    console.log(`${open} offres ouvertes en base. Tas limité à ${heapMb} Mo.`);

    // Premier passage « à froid » (tous les embeddings à calculer), puis « à
    // chaud », puis quatre candidats enchaînés dans le même processus.
    const passes: [Profile[], string][] = [
      [["broad"], "broad (à froid)"],
      [["broad"], "broad (à chaud)"],
      [["typical"], "typical"],
      [["broad", "typical", "broad", "typical"], "4 candidats enchaînés"],
    ];
    for (const [profiles, label] of passes) {
      const child = spawnSync(
        process.execPath,
        [
          `--max-old-space-size=${heapMb}`,
          "--expose-gc",
          "--import",
          "tsx",
          fileURLToPath(import.meta.url),
          "--measure",
          profiles.map((p) => users[p]).join(","),
          label,
        ],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: process.env },
      );
      const line = child.stdout.trim().split("\n").at(-1) ?? "";
      if (child.status === 0 && line.startsWith("{")) {
        results.push(JSON.parse(line) as Measure);
      } else {
        const fatal = /FatalProcessOutOfMemory|heap out of memory/.test(child.stderr);
        results.push({
          profile: label,
          ok: false,
          durationMs: 0,
          heapPeakMb: 0,
          rssPeakMb: 0,
          error: fatal
            ? `tas V8 saturé (signal ${child.signal ?? child.status})`
            : child.stderr.trim().split("\n").slice(-3).join(" | "),
        });
      }
    }
  } finally {
    // `--keep` : données laissées en base (diagnostic), puis `--cleanup <run>`.
    if (process.argv.includes("--keep")) console.log(`Données conservées : --cleanup ${run}`);
    else await cleanup(prisma, run);
    await prisma.$disconnect();
  }

  console.table(
    results.map(({ summary, liveMb, ...r }) => ({
      ...r,
      liveMb: liveMb?.join(" → "),
      ...(summary && typeof summary === "object" ? (summary as Record<string, unknown>) : {}),
    })),
  );
  return results.every((r) => r.ok && r.heapPeakMb < heapMb) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Échec du test de charge :", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
