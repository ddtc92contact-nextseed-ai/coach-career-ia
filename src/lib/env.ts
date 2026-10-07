import "server-only";
import { z } from "zod";

/**
 * Variables d'environnement serveur, validées à la première lecture (et non à
 * l'import) pour que `next build` fonctionne sans secrets.
 * Les secrets ne viennent QUE de l'environnement — jamais du dépôt.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET doit faire au moins 32 caractères"),
  EMAIL_FROM: z.string().min(3).default("Coach Career IA <no-reply@localhost>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  // "true" : TLS implicite (port 465). Sinon STARTTLS si le serveur le propose.
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      // On ne cite que les noms de variables, jamais leurs valeurs.
      const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Configuration invalide : ${names}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isSmtpConfigured(env: ServerEnv = serverEnv()): boolean {
  return Boolean(env.SMTP_HOST);
}
