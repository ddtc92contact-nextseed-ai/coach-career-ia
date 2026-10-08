import "server-only";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Adaptateur Auth.js durci pour les comptes à mot de passe :
 *
 * 1. Prise de contrôle avant inscription : quelqu'un peut inscrire l'adresse
 *    d'un tiers avec SON mot de passe (compte non vérifié). Si le vrai
 *    titulaire vérifie ensuite l'adresse par lien magique, ce mot de passe —
 *    choisi par une personne qui n'a jamais prouvé posséder l'adresse — est
 *    effacé dans la même transaction que la vérification, avec les jetons du
 *    compte. Il ne devient donc jamais valide.
 * 2. Les utilisateurs renvoyés à Auth.js ne portent ni hachage, ni paramètres
 *    de dérivation, ni identifiants de facturation.
 */

const PRIVATE_FIELDS = [
  "passwordHash",
  "kdfSalt",
  "kdfIterations",
  "passwordUpdatedAt",
  "stripeCustomerId",
  "stripeSubscriptionId",
] as const;

export function publicUser<T extends AdapterUser | null>(user: T): T {
  if (!user) return user;
  const copy = { ...user } as Record<string, unknown>;
  for (const field of PRIVATE_FIELDS) delete copy[field];
  return copy as T;
}

/**
 * Vérifie l'adresse et, si elle ne l'était pas encore, efface le mot de
 * passe non prouvé et les jetons du compte (même transaction). `true` si un
 * mot de passe a été effacé.
 */
export async function verifyEmailAndRevokeUnprovenPassword(
  userId: string,
  verifiedAt: Date,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, emailVerified: null, passwordHash: { not: null } },
      data: {
        emailVerified: verifiedAt,
        passwordHash: null,
        kdfSalt: null,
        kdfIterations: null,
        passwordUpdatedAt: null,
      },
    });
    if (count === 0) return false;
    await tx.authToken.deleteMany({ where: { userId } });
    return true;
  });
}

export function secureAdapter(base: Adapter): Adapter {
  return {
    ...base,
    createUser: async (user) => publicUser(await base.createUser!(user)),
    getUser: async (id) => publicUser(await base.getUser!(id)),
    getUserByEmail: async (email) => publicUser(await base.getUserByEmail!(email)),
    getUserByAccount: async (account) => publicUser(await base.getUserByAccount!(account)),
    updateUser: async (user) => {
      if (
        user.emailVerified &&
        (await verifyEmailAndRevokeUnprovenPassword(user.id, user.emailVerified))
      ) {
        logger.warn("auth.unproven_password_revoked", { userId: user.id });
      }
      return publicUser(await base.updateUser!(user));
    },
    getSessionAndUser: async (sessionToken) => {
      const result = await base.getSessionAndUser!(sessionToken);
      return result && { session: result.session, user: publicUser(result.user) };
    },
  };
}
