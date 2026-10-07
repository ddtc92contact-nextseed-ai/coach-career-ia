import { isAdminEmail } from "@/lib/auth/admin-emails";
import { coachMessagesPerDay } from "@/lib/coach/quota";

/**
 * Droits d'un compte selon son offre (freemium). LE seul endroit où une offre
 * est traduite en fonctionnalités : les pages, routes et actions demandent
 * `hasFeature(entitlements, "…")` ou lisent `limits`, jamais `user.plan`.
 * Lecture côté serveur : `getEntitlements(userId)` (`./server`).
 *
 * Module sans dépendance serveur : testable et partageable.
 */

export const PLANS = ["FREE", "PREMIUM"] as const;
export type PlanCode = (typeof PLANS)[number];

/** Fonctionnalités payantes (ajouter ici, puis les rattacher à une offre). */
export const FEATURES = ["coach.unlimited"] as const;
export type Feature = (typeof FEATURES)[number];

const PLAN_FEATURES: Record<PlanCode, readonly Feature[]> = {
  FREE: [],
  PREMIUM: ["coach.unlimited"],
};

/**
 * Origine des droits : offre gratuite, abonnement Stripe, ou accès offert aux
 * adresses de `ADMIN_EMAILS` (comptes de test du gérant).
 */
export type EntitlementSource = "free" | "subscription" | "admin";

export type Entitlements = {
  plan: PlanCode;
  source: EntitlementSource;
  features: readonly Feature[];
  limits: {
    /** Messages au coach sur 24 h glissantes ; `null` = illimité. */
    coachMessagesPerDay: number | null;
  };
};

type Env = Record<string, string | undefined>;

/**
 * `plan` est celui enregistré par le webhook Stripe (état de l'abonnement chez
 * Stripe) ; les administrateurs sont Premium quel que soit leur abonnement.
 */
export function entitlementsFor(
  account: { email: string; plan: PlanCode },
  env: Env = process.env,
): Entitlements {
  const admin = account.email !== "" && isAdminEmail(account.email, env.ADMIN_EMAILS ?? "");
  const plan: PlanCode = admin ? "PREMIUM" : account.plan;
  const source: EntitlementSource = admin ? "admin" : plan === "PREMIUM" ? "subscription" : "free";
  const features = PLAN_FEATURES[plan];
  return {
    plan,
    source,
    features,
    limits: {
      coachMessagesPerDay: features.includes("coach.unlimited") ? null : coachMessagesPerDay(env),
    },
  };
}

export function hasFeature(entitlements: Entitlements, feature: Feature): boolean {
  return entitlements.features.includes(feature);
}
