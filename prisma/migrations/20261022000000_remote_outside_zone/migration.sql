-- Télétravail complet hors zone (issue #66) : une offre en télétravail complet
-- située hors de la zone du candidat ne lui est proposée qu'avec son accord.
-- Défaut : pas d'accord, sauf pour les candidats qui ne veulent QUE du
-- télétravail complet (l'accord leur est implicite).
-- AlterTable
ALTER TABLE "guard_rails" ADD COLUMN     "accepts_remote_outside_zone" BOOLEAN NOT NULL DEFAULT false;

UPDATE "guard_rails" SET "accepts_remote_outside_zone" = true WHERE "remote_policy" = 'FULL_REMOTE';

-- Règle de zone modifiée : tous les candidats sont à recalculer (cf. `markAllCandidatesDirty`).
INSERT INTO "matching_states" ("user_id", "dirty_at", "updated_at")
SELECT "user_id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "guard_rails"
ON CONFLICT ("user_id") DO UPDATE SET "dirty_at" = EXCLUDED."dirty_at", "updated_at" = EXCLUDED."updated_at";
