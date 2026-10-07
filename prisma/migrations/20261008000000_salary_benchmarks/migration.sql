-- Market Radar : repères de salaire du marché tirés des offres publiées (issue #34).
-- CreateEnum
CREATE TYPE "SalaryBenchmarkScope" AS ENUM ('REGION', 'COUNTRY', 'FAMILY_COUNTRY');

-- CreateTable
CREATE TABLE "salary_benchmarks" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" "SalaryBenchmarkScope" NOT NULL,
    "family" TEXT NOT NULL,
    "seniority" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "area" TEXT,
    "sample_size" INTEGER NOT NULL,
    "p25" INTEGER NOT NULL,
    "median" INTEGER NOT NULL,
    "p75" INTEGER NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_benchmarks_key_key" ON "salary_benchmarks"("key");

-- CreateIndex
CREATE INDEX "salary_benchmarks_family_country_idx" ON "salary_benchmarks"("family", "country");

