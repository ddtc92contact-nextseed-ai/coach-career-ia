-- CreateTable
CREATE TABLE "identity_vaults" (
    "user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kdf_name" TEXT NOT NULL,
    "kdf_iterations" INTEGER NOT NULL,
    "kdf_salt" BYTEA NOT NULL,
    "passphrase_wrapped_key" BYTEA NOT NULL,
    "recovery_wrapped_key" BYTEA NOT NULL,
    "identity_ciphertext" BYTEA,
    "cv_ciphertext" BYTEA,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_vaults_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "identity_vaults" ADD CONSTRAINT "identity_vaults_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
