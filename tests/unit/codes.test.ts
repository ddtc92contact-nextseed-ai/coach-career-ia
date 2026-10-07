import { describe, expect, it } from "vitest";
import * as PrismaEnums from "@/generated/prisma/enums";
import * as codes from "@/lib/career/codes";
import { MESSAGES } from "@/i18n/messages";

describe("codes partagés", () => {
  it.each([
    ["VisibilityStatus", codes.VISIBILITY_STATUSES],
    ["Seniority", codes.SENIORITIES],
    ["CompanySize", codes.COMPANY_SIZES],
    ["CompanyStage", codes.COMPANY_STAGES],
    ["EvidenceLevel", codes.EVIDENCE_LEVELS],
    ["ProofKind", codes.PROOF_KINDS],
  ] as const)("%s correspond à l'enum Prisma", (name, list) => {
    expect(Object.values(PrismaEnums[name]).sort()).toEqual([...list].sort());
  });

  // Enums partagés avec le Market Radar : le candidat n'en choisit qu'une partie
  // (jamais les valeurs « inconnu » / « autre » du radar).
  it.each([
    ["ContractType", codes.CONTRACT_TYPES],
    ["RemotePolicy", codes.REMOTE_POLICIES],
  ] as const)("%s est un sous-ensemble explicite de l'enum Prisma", (name, list) => {
    const values: string[] = Object.values(PrismaEnums[name]);
    for (const code of list) expect(values).toContain(code);
    expect(list).not.toContain("UNKNOWN");
    expect(list).not.toContain("OTHER");
  });

  it.each([
    ["sector", codes.SECTORS],
    ["culture", codes.CULTURE_PREFERENCES],
    ["seniority", codes.SENIORITIES],
    ["contractType", codes.CONTRACT_TYPES],
    ["companySize", codes.COMPANY_SIZES],
    ["companyStage", codes.COMPANY_STAGES],
    ["remotePolicy", codes.REMOTE_POLICIES],
    ["evidence", codes.EVIDENCE_LEVELS],
    ["skillLevel", codes.SKILL_LEVELS],
    ["visibility", codes.VISIBILITY_STATUSES],
  ] as const)("chaque code « %s » a une traduction", (family, list) => {
    const translations = MESSAGES.fr.codes[family] as Record<string, unknown>;
    expect(Object.keys(translations).sort()).toEqual([...list].sort());
  });
});
