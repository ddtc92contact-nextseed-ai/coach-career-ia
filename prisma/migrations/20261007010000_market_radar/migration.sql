-- CreateEnum
CREATE TYPE "AtsType" AS ENUM ('GREENHOUSE', 'LEVER', 'ASHBY');

-- CreateEnum
CREATE TYPE "RemotePolicy" AS ENUM ('ONSITE', 'HYBRID', 'FULL_REMOTE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('CDI', 'CDD', 'FREELANCE', 'INTERNSHIP', 'APPRENTICESHIP', 'TEMPORARY', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SalaryPeriod" AS ENUM ('HOUR', 'DAY', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SourceRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "sector" TEXT,
    "ats_type" "AtsType",
    "board_token" TEXT,
    "ats_region" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offers" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "url_key" TEXT NOT NULL,
    "dedup_key" TEXT,
    "title" TEXT NOT NULL,
    "company_name" TEXT,
    "company_id" TEXT,
    "description" TEXT NOT NULL,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "remote_policy" "RemotePolicy" NOT NULL DEFAULT 'UNKNOWN',
    "contract_type" "ContractType" NOT NULL DEFAULT 'UNKNOWN',
    "contract_label" TEXT,
    "salary_min" DECIMAL(12,2),
    "salary_max" DECIMAL(12,2),
    "salary_currency" TEXT,
    "salary_period" "SalaryPeriod",
    "salary_variable" TEXT,
    "salary_equity" TEXT,
    "salary_raw" TEXT,
    "sector" TEXT,
    "seniority" TEXT,
    "published_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "content_hash" TEXT NOT NULL,
    "duplicate_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_runs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "status" "SourceRunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "fetched_count" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "unchanged_count" INTEGER NOT NULL DEFAULT 0,
    "closed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "source_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_ats_type_board_token_key" ON "companies"("ats_type", "board_token");

-- CreateIndex
CREATE INDEX "job_offers_source_key_status_idx" ON "job_offers"("source_key", "status");

-- CreateIndex
CREATE INDEX "job_offers_url_key_idx" ON "job_offers"("url_key");

-- CreateIndex
CREATE INDEX "job_offers_dedup_key_idx" ON "job_offers"("dedup_key");

-- CreateIndex
CREATE INDEX "job_offers_status_last_seen_at_idx" ON "job_offers"("status", "last_seen_at");

-- CreateIndex
CREATE INDEX "job_offers_company_id_idx" ON "job_offers"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_offers_source_source_id_key" ON "job_offers"("source", "source_id");

-- CreateIndex
CREATE INDEX "source_runs_started_at_idx" ON "source_runs"("started_at");

-- CreateIndex
CREATE INDEX "source_runs_source_key_started_at_idx" ON "source_runs"("source_key", "started_at");

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "job_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
