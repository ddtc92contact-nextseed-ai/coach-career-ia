-- Matching : correspondances expliquées, état de recalcul / alertes, embeddings pgvector (issue #12).
-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('NEW', 'SEEN', 'SAVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('OFF', 'DAILY', 'WEEKLY');

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "explanation" JSONB NOT NULL,
    "input_hash" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'NEW',
    "computed_at" TIMESTAMP(3) NOT NULL,
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching_states" (
    "user_id" TEXT NOT NULL,
    "dirty_at" TIMESTAMP(3),
    "computed_at" TIMESTAMP(3),
    "alert_frequency" "AlertFrequency" NOT NULL DEFAULT 'OFF',
    "alert_min_score" INTEGER NOT NULL DEFAULT 70,
    "alert_sent_at" TIMESTAMP(3),
    "alert_token" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matching_states_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "offer_embeddings" (
    "offer_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "embedding" vector NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_embeddings_pkey" PRIMARY KEY ("offer_id")
);

-- CreateTable
CREATE TABLE "memory_embeddings" (
    "user_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "embedding" vector NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_embeddings_pkey" PRIMARY KEY ("user_id","model","text_hash")
);

-- CreateIndex
CREATE INDEX "matches_user_id_score_idx" ON "matches"("user_id", "score");

-- CreateIndex
CREATE INDEX "matches_offer_id_idx" ON "matches"("offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "matches_user_id_offer_id_key" ON "matches"("user_id", "offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "matching_states_alert_token_key" ON "matching_states"("alert_token");

-- CreateIndex
CREATE INDEX "matching_states_dirty_at_idx" ON "matching_states"("dirty_at");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching_states" ADD CONSTRAINT "matching_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_embeddings" ADD CONSTRAINT "offer_embeddings_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Les candidats ayant déjà des garde-fous sont recalculés au premier passage du worker.
INSERT INTO "matching_states" ("user_id", "dirty_at", "updated_at")
SELECT "user_id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "guard_rails"
ON CONFLICT ("user_id") DO NOTHING;
