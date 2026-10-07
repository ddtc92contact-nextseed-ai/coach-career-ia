import { billingConfigFromEnv, billingMode } from "@/lib/billing/config";
import { prismaBillingStore } from "@/lib/billing/repository";
import { getStripe } from "@/lib/billing/server";
import { handleStripeWebhook } from "@/lib/billing/webhook";
import { logger } from "@/lib/logger";

/**
 * Webhook Stripe (`/api/stripe/webhook`). Le corps est lu brut : la signature
 * (`Stripe-Signature`) porte sur les octets exacts envoyés par Stripe.
 * Actif seulement avec `BILLING_PROVIDER=stripe` (le simulateur livre ses
 * évènements au même traitement, sans passer par HTTP).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const config = billingConfigFromEnv();
  const stripe = getStripe();
  if (billingMode() !== "stripe" || !config || !stripe)
    return json({ error: "billingNotConfigured" }, 503);

  try {
    const result = await handleStripeWebhook({
      payload: await request.text(),
      signature: request.headers.get("stripe-signature"),
      secret: config.webhookSecret,
      stripe,
      store: prismaBillingStore,
      logger,
    });
    return json(result.body, result.status);
  } catch (error) {
    // Stripe renverra l'évènement plus tard (rien n'a été enregistré).
    logger.error("billing.webhook.failed", { error });
    return json({ error: "processingFailed" }, 500);
  }
}
