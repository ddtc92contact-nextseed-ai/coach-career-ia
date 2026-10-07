-- Pages légales (issue #40) : version et date d'acceptation des conditions,
-- sur le compte (candidat) et sur l'organisation (conditions entreprises).
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_version" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_version" TEXT;
