-- Un seul tour du coach à la fois par conversation, relances plafonnées.
-- AlterTable
ALTER TABLE "coach_conversations" ADD COLUMN     "turn_started_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "coach_messages" ADD COLUMN     "retry_count" INTEGER NOT NULL DEFAULT 0;
