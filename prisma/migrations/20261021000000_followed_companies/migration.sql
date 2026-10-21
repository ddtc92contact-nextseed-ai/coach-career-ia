-- « Mes entreprises à suivre » (issue #57) : entreprises ajoutées par les candidats,
-- partagées par tous, et lien candidat ↔ entreprise suivie (donnée personnelle,
-- supprimée avec le compte). Les entreprises existantes viennent de la configuration.
-- CreateEnum
CREATE TYPE "CompanyOrigin" AS ENUM ('CONFIG', 'USER');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "origin" "CompanyOrigin" NOT NULL DEFAULT 'CONFIG';

-- CreateTable
CREATE TABLE "followed_companies" (
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followed_companies_pkey" PRIMARY KEY ("user_id","company_id")
);

-- CreateIndex
CREATE INDEX "followed_companies_company_id_idx" ON "followed_companies"("company_id");

-- AddForeignKey
ALTER TABLE "followed_companies" ADD CONSTRAINT "followed_companies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followed_companies" ADD CONSTRAINT "followed_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

