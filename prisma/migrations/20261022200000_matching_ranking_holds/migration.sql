-- Matching : un classement qui tient (issue #77). Le calcul du score change
-- (calibration sans saturation au p99, agrégation sur tout le parcours,
-- appui lexical exigé, salaire non annoncé neutre) : tous les candidats sont
-- recalculés au prochain passage du worker, et leurs opportunités périmées
-- remplacées (cf. `markAllCandidatesDirty`).
INSERT INTO "matching_states" ("user_id", "dirty_at", "updated_at")
SELECT "user_id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "guard_rails"
ON CONFLICT ("user_id") DO UPDATE SET "dirty_at" = EXCLUDED."dirty_at", "updated_at" = EXCLUDED."updated_at";
