-- Passages du radar (issue #61) : un seul passage à la fois, durée et
-- compteurs par source affichés sur /app/radar.
-- CreateEnum
CREATE TYPE "RadarPassStatus" AS ENUM ('RUNNING', 'FINISHED', 'INTERRUPTED');

-- CreateTable
CREATE TABLE "radar_passes" (
    "id" TEXT NOT NULL,
    "status" "RadarPassStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "sources" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "by_source" JSONB,

    CONSTRAINT "radar_passes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "radar_passes_started_at_idx" ON "radar_passes"("started_at");
