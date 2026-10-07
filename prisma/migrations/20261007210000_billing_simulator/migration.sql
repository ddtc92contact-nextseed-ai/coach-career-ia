-- Simulateur de paiement (phase de test) : état d'abonnement que Stripe tiendrait, identifiants `sim_`.
-- CreateTable
CREATE TABLE "simulated_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "checkout_session_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "current_period_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulated_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "simulated_subscriptions_checkout_session_id_key" ON "simulated_subscriptions"("checkout_session_id");

-- CreateIndex
CREATE INDEX "simulated_subscriptions_user_id_status_idx" ON "simulated_subscriptions"("user_id", "status");

-- AddForeignKey
ALTER TABLE "simulated_subscriptions" ADD CONSTRAINT "simulated_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
