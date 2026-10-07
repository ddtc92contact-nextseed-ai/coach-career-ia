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
 * Reporte la configuration en base (upsert par slug, idempotent) et renvoie
 * les entreprises actives à collecter. Une entreprise retirée du fichier est
 * désactivée, pas supprimée (ses offres restent consultables).
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
    };
    const row = await prisma.company.upsert({
      where: { slug: c.slug },
      update: data,
      create: { slug: c.slug, ...data },
    });
    if (row.active) {
      companies.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        sector: row.sector,
        atsType: data.atsType,
        boardToken: c.boardToken,
        atsRegion: row.atsRegion,
      });
    }
  }
  await prisma.company.updateMany({
    where: { slug: { notIn: config.map((c) => c.slug) }, atsType: { not: null } },
    data: { active: false },
  });
  return companies;
}
