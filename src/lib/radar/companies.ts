import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AtsType } from "@/generated/prisma/enums";
import type { AtsCompany } from "./connectors/ats";

const ATS: Record<string, AtsType> = {
  greenhouse: "GREENHOUSE",
  lever: "LEVER",
  ashby: "ASHBY",
  smartrecruiters: "SMARTRECRUITERS",
  recruitee: "RECRUITEE",
  workable: "WORKABLE",
};

export const companyConfigSchema = z
  .array(
    z.object({
      slug: z.string().regex(/^[a-z0-9-]+$/, "slug en minuscules, chiffres et tirets"),
      name: z.string().min(1),
      website: z.url().optional(),
      sector: z.string().optional(),
      ats: z.enum(["greenhouse", "lever", "ashby", "smartrecruiters", "recruitee", "workable"]),
      boardToken: z.string().regex(/^[A-Za-z0-9._-]+$/),
      region: z.enum(["eu"]).optional(),
      active: z.boolean().default(true),
    }),
  )
  .refine((list) => new Set(list.map((c) => c.slug)).size === list.length, "slugs en double");

export type CompanyConfig = z.infer<typeof companyConfigSchema>;

export async function loadCompanyConfig(path: string): Promise<CompanyConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const parsed = companyConfigSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`Liste d'entreprises invalide (${path}) : ${parsed.error.message}`);
  return parsed.data;
}

/**
 * Reporte la configuration en base (idempotent) et renvoie les entreprises
 * actives de la liste de référence. Une entreprise déjà ajoutée par un
 * candidat avec le même board est rattachée à la configuration (un board =
 * une entreprise). Une entreprise retirée du fichier est désactivée, pas
 * supprimée (ses offres restent consultables) — sauf si des candidats la
 * suivent : elle reste alors surveillée comme entreprise ajoutée.
 */
export async function syncCompanies(
  prisma: PrismaClient,
  config: CompanyConfig,
): Promise<AtsCompany[]> {
  const companies: AtsCompany[] = [];
  for (const c of config) {
    const data = {
      name: c.name,
      website: c.website ?? null,
      sector: c.sector ?? null,
      atsType: ATS[c.ats]!,
      boardToken: c.boardToken,
      atsRegion: c.region ?? null,
      active: c.active,
      origin: "CONFIG" as const,
    };
    const existing =
      (await prisma.company.findUnique({ where: { slug: c.slug }, select: { id: true } })) ??
      (await prisma.company.findUnique({
        where: { atsType_boardToken: { atsType: data.atsType, boardToken: c.boardToken } },
        select: { id: true },
      }));
    const row = existing
      ? await prisma.company.update({ where: { id: existing.id }, data: { slug: c.slug, ...data } })
      : await prisma.company.create({ data: { slug: c.slug, ...data } });
    if (row.active) companies.push(toAtsCompany(row)!);
  }
  const removed = {
    slug: { notIn: config.map((c) => c.slug) },
    atsType: { not: null },
    origin: "CONFIG" as const,
  };
  await prisma.company.updateMany({
    where: { ...removed, followers: { some: {} } },
    data: { origin: "USER" },
  });
  await prisma.company.updateMany({ where: removed, data: { active: false } });
  return companies;
}

type CompanyRow = {
  id: string;
  slug: string;
  name: string;
  sector: string | null;
  atsType: AtsType | null;
  boardToken: string | null;
  atsRegion: string | null;
};

function toAtsCompany(row: CompanyRow): AtsCompany | null {
  if (!row.atsType || !row.boardToken) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sector: row.sector,
    atsType: row.atsType,
    boardToken: row.boardToken,
    atsRegion: row.atsRegion,
  };
}

/**
 * Entreprises surveillées à ce passage : l'union des entreprises de la
 * configuration et de celles ajoutées par des candidats qui ont encore au
 * moins un abonné. Chaque board n'apparaît qu'une fois (unicité ATS + jeton) :
 * il est collecté une seule fois par passage, quel que soit son nombre
 * d'abonnés.
 */
export async function loadWatchedCompanies(prisma: PrismaClient): Promise<AtsCompany[]> {
  const rows = await prisma.company.findMany({
    where: {
      active: true,
      atsType: { not: null },
      boardToken: { not: null },
      OR: [{ origin: "CONFIG" }, { followers: { some: {} } }],
    },
    orderBy: [{ origin: "asc" }, { slug: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      sector: true,
      atsType: true,
      boardToken: true,
      atsRegion: true,
    },
  });
  return rows.map(toAtsCompany).filter((c): c is AtsCompany => c !== null);
}

/** Entreprises du radar pour la page d'administration : origine, abonnés, offres ouvertes. */
export async function listRadarCompanies(prisma: PrismaClient) {
  return prisma.company.findMany({
    where: { atsType: { not: null } },
    orderBy: [{ active: "desc" }, { origin: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      atsType: true,
      boardToken: true,
      origin: true,
      active: true,
      createdAt: true,
      _count: {
        select: {
          followers: true,
          offers: { where: { status: "OPEN", duplicateOfId: null } },
        },
      },
    },
  });
}
