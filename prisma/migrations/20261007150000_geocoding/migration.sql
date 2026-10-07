-- Géocodage : coordonnées des offres et cache persistant (issue #11).
-- AlterTable
ALTER TABLE "job_offers" ADD COLUMN     "geocoded_at" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "geo_cache" (
    "key" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "country" TEXT,
    "precision" TEXT,
    "provider" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_cache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "job_offers_status_geocoded_at_idx" ON "job_offers"("status", "geocoded_at");

