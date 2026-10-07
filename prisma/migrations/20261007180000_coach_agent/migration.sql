-- CreateEnum
CREATE TYPE "CoachMode" AS ENUM ('DISCOVER', 'CLARIFY', 'INTERVIEW');

-- CreateEnum
CREATE TYPE "CoachRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "CoachSuggestionKind" AS ENUM ('ACHIEVEMENT', 'EXPERIENCE_UPDATE', 'SKILL', 'GUARD_RAIL');

-- CreateEnum
CREATE TYPE "CoachSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "coach_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mode" "CoachMode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "CoachRole" NOT NULL,
    "content_enc" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_suggestions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT,
    "kind" "CoachSuggestionKind" NOT NULL,
    "status" "CoachSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "identity_removed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "coach_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_conversations_user_id_updated_at_idx" ON "coach_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "coach_messages_conversation_id_created_at_idx" ON "coach_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "coach_messages_user_id_role_created_at_idx" ON "coach_messages"("user_id", "role", "created_at");

-- CreateIndex
CREATE INDEX "coach_suggestions_user_id_idx" ON "coach_suggestions"("user_id");

-- CreateIndex
CREATE INDEX "coach_suggestions_conversation_id_idx" ON "coach_suggestions"("conversation_id");

-- CreateIndex
CREATE INDEX "coach_suggestions_message_id_idx" ON "coach_suggestions"("message_id");

-- AddForeignKey
ALTER TABLE "coach_conversations" ADD CONSTRAINT "coach_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "coach_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_suggestions" ADD CONSTRAINT "coach_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_suggestions" ADD CONSTRAINT "coach_suggestions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "coach_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_suggestions" ADD CONSTRAINT "coach_suggestions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "coach_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

