-- Market Radar : signaux faibles de recrutement par entreprise (issue #27).
-- CreateEnum
CREATE TYPE "CompanySignalType" AS ENUM ('HIRING_SURGE', 'HIRING_FREEZE', 'NEW_TEAM', 'NEW_LOCATION', 'REPOSTED_OFFER', 'REMOTE_SHIFT');

-- AlterTable
ALTER TABLE "job_offers" ADD COLUMN     "reopen_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reopened_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "company_week_stats" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "new_offers" INTEGER NOT NULL,
    "closed_offers" INTEGER NOT NULL,
    "open_count" INTEGER NOT NULL,
    "median_days_to_close" DOUBLE PRECISION,
    "salary_share" DOUBLE PRECISION,
    "remote_share" DOUBLE PRECISION,
    "new_cities" TEXT[],
    "new_countries" TEXT[],
    "new_families" TEXT[],
    "first_leadership" BOOLEAN NOT NULL DEFAULT false,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_week_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_signals" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type" "CompanySignalType" NOT NULL,
    "strength" INTEGER NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "facts" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_week_stats_company_id_week_start_key" ON "company_week_stats"("company_id", "week_start");

-- CreateIndex
CREATE INDEX "company_signals_period_start_idx" ON "company_signals"("period_start");

-- CreateIndex
CREATE UNIQUE INDEX "company_signals_company_id_type_period_start_key" ON "company_signals"("company_id", "type", "period_start");

-- AddForeignKey
ALTER TABLE "company_week_stats" ADD CONSTRAINT "company_week_stats_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_signals" ADD CONSTRAINT "company_signals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
