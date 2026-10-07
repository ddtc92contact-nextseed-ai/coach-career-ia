-- Levée d'anonymat (issue #26) : révélation des champs choisis de l'identité à
-- une entreprise (un contact), lien à jeton expirant et révocable, journal.

-- Le point d'accroche de #21 devient la date de passage du fil à « révélé ».
ALTER TABLE "contacts" RENAME COLUMN "handover_requested_at" TO "revealed_at";

-- CreateEnum
CREATE TYPE "HandoverEventType" AS ENUM ('REVEALED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "handovers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "fields" TEXT[],
    "payload_enc" TEXT,
    "cv_enc" BYTEA,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "purged_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "handover_id" TEXT,
    "type" "HandoverEventType" NOT NULL,
    "fields" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "handovers_token_hash_key" ON "handovers"("token_hash");

-- CreateIndex
CREATE INDEX "handovers_user_id_contact_id_idx" ON "handovers"("user_id", "contact_id");

-- CreateIndex
CREATE INDEX "handovers_purged_at_expires_at_idx" ON "handovers"("purged_at", "expires_at");

-- CreateIndex
CREATE INDEX "handover_events_user_id_contact_id_created_at_idx" ON "handover_events"("user_id", "contact_id", "created_at");

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_events" ADD CONSTRAINT "handover_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_events" ADD CONSTRAINT "handover_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_events" ADD CONSTRAINT "handover_events_handover_id_fkey" FOREIGN KEY ("handover_id") REFERENCES "handovers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Au plus une levée d'anonymat active (non révoquée, non purgée) par contact.
CREATE UNIQUE INDEX "handovers_one_active_per_contact" ON "handovers"("contact_id") WHERE "revoked_at" IS NULL AND "purged_at" IS NULL;
