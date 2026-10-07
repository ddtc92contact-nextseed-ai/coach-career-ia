-- Espace entreprise v2 (issue #33) : prises de contact sur les offres publiées
-- directement, remises dans la messagerie de l'organisation (canal PORTAL).
-- Les réponses de l'entreprise restent des `contact_replies` (un seul modèle de message).

-- AlterEnum
ALTER TYPE "ContactChannel" ADD VALUE 'PORTAL';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "org_id" TEXT,
ADD COLUMN     "org_read_at" TIMESTAMP(3),
ADD COLUMN     "org_closed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contact_replies" ADD COLUMN     "author_id" TEXT,
ADD COLUMN     "closing" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "contacts_org_id_status_idx" ON "contacts"("org_id", "status");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_replies" ADD CONSTRAINT "contact_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
