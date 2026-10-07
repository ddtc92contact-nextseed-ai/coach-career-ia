import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env";

/**
 * Client Prisma unique, créé à la première utilisation (le build n'a donc pas
 * besoin de DATABASE_URL) et réutilisé entre rechargements à chaud en dev.
 *
 * Isolation des données : toute requête sur une donnée métier DOIT être
 * filtrée par l'identifiant renvoyé par `requireUser()`
 * (ex. `where: { userId: user.id }`). Aucun log Prisma n'est activé : les
 * paramètres de requête peuvent contenir des données personnelles.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function client(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient(serverEnv().DATABASE_URL);
  return globalForPrisma.prisma;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const real = client();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === "function" ? value.bind(real) : value;
  },
});
