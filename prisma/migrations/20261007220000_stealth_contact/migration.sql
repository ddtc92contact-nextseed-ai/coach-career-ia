-- Stealth Proxy (issue #21) : canal de candidature des offres, carte de profil anonyme,
-- liens publics à jeton, prises de contact approuvées et réponses des entreprises.
-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('EMAIL', 'APPLY_URL');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENDING', 'SENT');

-- AlterTable
ALTER TABLE "job_offers" ADD COLUMN     "apply_email" TEXT,
ADD COLUMN     "apply_email_personal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "apply_url" TEXT;

-- CreateTable
CREATE TABLE "profile_cards" (
    "user_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_cards_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "card_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'DRAFT',
    "locale" TEXT NOT NULL,
    "subject_enc" TEXT NOT NULL,
    "body_enc" TEXT NOT NULL,
    "draft_source" TEXT NOT NULL,
    "approved_hash" TEXT,
    "approved_at" TIMESTAMP(3),
    "sent_text_enc" TEXT,
    "sent_at" TIMESTAMP(3),
    "card_link_id" TEXT,
    "last_error" TEXT,
    "handover_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_replies" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "body_enc" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "card_links_token_hash_key" ON "card_links"("token_hash");

-- CreateIndex
CREATE INDEX "card_links_user_id_idx" ON "card_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_card_link_id_key" ON "contacts"("card_link_id");

-- CreateIndex
CREATE INDEX "contacts_user_id_sent_at_idx" ON "contacts"("user_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_user_id_offer_id_key" ON "contacts"("user_id", "offer_id");

-- CreateIndex
CREATE INDEX "contact_replies_user_id_created_at_idx" ON "contact_replies"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "contact_replies_contact_id_created_at_idx" ON "contact_replies"("contact_id", "created_at");

-- AddForeignKey
ALTER TABLE "profile_cards" ADD CONSTRAINT "profile_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_card_link_id_fkey" FOREIGN KEY ("card_link_id") REFERENCES "card_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_replies" ADD CONSTRAINT "contact_replies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_replies" ADD CONSTRAINT "contact_replies_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

