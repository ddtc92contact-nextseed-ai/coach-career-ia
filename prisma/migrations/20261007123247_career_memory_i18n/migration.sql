-- Les enums "ContractType" et "RemotePolicy" sont créés par la migration Market Radar.

-- CreateEnum
CREATE TYPE "VisibilityStatus" AS ENUM ('ACTIVE', 'OPEN', 'INVISIBLE');

-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'MANAGER', 'DIRECTOR', 'EXECUTIVE');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('S1_10', 'S11_50', 'S51_200', 'S201_500', 'S501_1000', 'S1001_5000', 'S5001_PLUS');

-- CreateEnum
CREATE TYPE "CompanyStage" AS ENUM ('STARTUP', 'SCALEUP', 'SME', 'MIDCAP', 'LARGE_CORP', 'PUBLIC_SECTOR', 'NONPROFIT', 'CONSULTANCY');

-- CreateEnum
CREATE TYPE "EvidenceLevel" AS ENUM ('DECLARED', 'DOCUMENT', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ProofKind" AS ENUM ('URL', 'DOCUMENT', 'REFERENCE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" TEXT;

-- CreateTable
CREATE TABLE "career_profiles" (
    "user_id" TEXT NOT NULL,
    "visibility" "VisibilityStatus" NOT NULL DEFAULT 'INVISIBLE',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "experiences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_title" TEXT NOT NULL,
    "start_month" DATE NOT NULL,
    "end_month" DATE,
    "seniority" "Seniority" NOT NULL,
    "contract_type" "ContractType" NOT NULL,
    "sector" TEXT NOT NULL,
    "company_size" "CompanySize" NOT NULL,
    "company_stage" "CompanyStage" NOT NULL,
    "responsibilities" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "experience_id" TEXT,
    "title" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT '',
    "actions" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT '',
    "evidence_level" "EvidenceLevel" NOT NULL DEFAULT 'DECLARED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proofs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "achievement_id" TEXT NOT NULL,
    "kind" "ProofKind" NOT NULL,
    "url" TEXT,
    "reference_text" TEXT,
    "storage_key" TEXT,
    "file_name_enc" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_skills" (
    "achievement_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,

    CONSTRAINT "achievement_skills_pkey" PRIMARY KEY ("achievement_id","skill_id")
);

-- CreateTable
CREATE TABLE "guard_rails" (
    "user_id" TEXT NOT NULL,
    "min_fixed_salary" INTEGER,
    "target_total_package" INTEGER,
    "remote_policy" "RemotePolicy",
    "min_remote_days" INTEGER,
    "contract_types" "ContractType"[],
    "excluded_sectors" TEXT[],
    "excluded_companies_enc" TEXT[],
    "max_weekly_hours" INTEGER,
    "accepts_on_call" BOOLEAN NOT NULL DEFAULT false,
    "culture_preferences" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guard_rails_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "guard_rail_locations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "radius_km" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guard_rail_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "experiences_user_id_idx" ON "experiences"("user_id");

-- CreateIndex
CREATE INDEX "achievements_user_id_idx" ON "achievements"("user_id");

-- CreateIndex
CREATE INDEX "achievements_experience_id_idx" ON "achievements"("experience_id");

-- CreateIndex
CREATE UNIQUE INDEX "proofs_storage_key_key" ON "proofs"("storage_key");

-- CreateIndex
CREATE INDEX "proofs_user_id_idx" ON "proofs"("user_id");

-- CreateIndex
CREATE INDEX "proofs_achievement_id_idx" ON "proofs"("achievement_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_user_id_name_key_key" ON "skills"("user_id", "name_key");

-- CreateIndex
CREATE INDEX "achievement_skills_skill_id_idx" ON "achievement_skills"("skill_id");

-- CreateIndex
CREATE INDEX "guard_rail_locations_user_id_idx" ON "guard_rail_locations"("user_id");

-- AddForeignKey
ALTER TABLE "career_profiles" ADD CONSTRAINT "career_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "experiences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_skills" ADD CONSTRAINT "achievement_skills_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_skills" ADD CONSTRAINT "achievement_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guard_rails" ADD CONSTRAINT "guard_rails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guard_rail_locations" ADD CONSTRAINT "guard_rail_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
