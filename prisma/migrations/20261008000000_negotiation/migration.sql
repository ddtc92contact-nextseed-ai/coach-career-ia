-- Agent de négociation (issue #31) : mandat du candidat par contact et fil de
-- négociation (contre-propositions approuvées par le candidat, réponses de l'entreprise).
-- CreateEnum
CREATE TYPE "NegotiationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "NegotiationDirection" AS ENUM ('OUT', 'IN');

-- CreateTable
CREATE TABLE "negotiation_mandates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "content_enc" TEXT NOT NULL,
    "status" "NegotiationStatus" NOT NULL DEFAULT 'ACTIVE',
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "negotiation_mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "direction" "NegotiationDirection" NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'DRAFT',
    "body_enc" TEXT NOT NULL,
    "draft_source" TEXT,
    "approved_hash" TEXT,
    "approved_at" TIMESTAMP(3),
    "sent_text_enc" TEXT,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "card_link_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "negotiation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "negotiation_mandates_contact_id_key" ON "negotiation_mandates"("contact_id");

-- CreateIndex
CREATE INDEX "negotiation_mandates_user_id_idx" ON "negotiation_mandates"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "negotiation_messages_card_link_id_key" ON "negotiation_messages"("card_link_id");

-- CreateIndex
CREATE INDEX "negotiation_messages_contact_id_created_at_idx" ON "negotiation_messages"("contact_id", "created_at");

-- CreateIndex
CREATE INDEX "negotiation_messages_user_id_sent_at_idx" ON "negotiation_messages"("user_id", "sent_at");

-- AddForeignKey
ALTER TABLE "negotiation_mandates" ADD CONSTRAINT "negotiation_mandates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_mandates" ADD CONSTRAINT "negotiation_mandates_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_card_link_id_fkey" FOREIGN KEY ("card_link_id") REFERENCES "card_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Au plus un message sortant non envoyé (brouillon, approuvé ou en cours d'envoi) par contact.
CREATE UNIQUE INDEX "negotiation_messages_one_pending_per_contact" ON "negotiation_messages"("contact_id") WHERE "direction" = 'OUT' AND "status" IN ('DRAFT', 'APPROVED', 'SENDING');
