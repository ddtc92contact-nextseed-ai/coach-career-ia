import { describe, expect, it } from "vitest";
import * as PrismaEnums from "@/generated/prisma/enums";
import * as codes from "@/lib/career/codes";
import { MESSAGES } from "@/i18n/messages";

describe("codes partagés", () => {
  it.each([
    ["VisibilityStatus", codes.VISIBILITY_STATUSES],
    ["Seniority", codes.SENIORITIES],
    ["ContractType", codes.CONTRACT_TYPES],
    ["CompanySize", codes.COMPANY_SIZES],
    ["CompanyStage", codes.COMPANY_STAGES],
    ["EvidenceLevel", codes.EVIDENCE_LEVELS],
    ["ProofKind", codes.PROOF_KINDS],
    ["RemotePolicy", codes.REMOTE_POLICIES],
  ] as const)("%s correspond à l'enum Prisma", (name, list) => {
    expect(Object.values(PrismaEnums[name]).sort()).toEqual([...list].sort());
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
