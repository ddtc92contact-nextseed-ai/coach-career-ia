-- Embeddings (issue #69) : une offre dont le texte est refusé seul par le
-- fournisseur (400) n'est plus renvoyée tant que son texte ne change pas.
-- CreateTable
CREATE TABLE "offer_embedding_rejections" (
    "offer_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_embedding_rejections_pkey" PRIMARY KEY ("offer_id")
);

-- AddForeignKey
ALTER TABLE "offer_embedding_rejections" ADD CONSTRAINT "offer_embedding_rejections_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "job_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
