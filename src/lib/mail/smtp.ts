import nodemailer from "nodemailer";
import { z } from "zod";

/**
 * Transport SMTP partagé (lien magique, alertes d'opportunités). Sans
 * `server-only` : utilisable par le worker. Réglages lus depuis
 * l'environnement uniquement ; jamais journalisés.
 */

export type SmtpSettings = {
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
};

const smtpEnvSchema = z.object({
  EMAIL_FROM: z.string().min(3).default("Coach Career IA <no-reply@localhost>"),
  SMTP_HOST: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SMTP_PASSWORD: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export function smtpSettingsFromEnv(env: Record<string, string | undefined> = process.env) {
  const parsed = smtpEnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuration e-mail invalide : ${names}`);
  }
  const e = parsed.data;
  return {
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    user: e.SMTP_USER,
    password: e.SMTP_PASSWORD,
    from: e.EMAIL_FROM,
  } satisfies SmtpSettings;
}

export function createSmtpTransport(settings: SmtpSettings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
  });
}

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
};

export type MailSender = (message: MailMessage) => Promise<void>;

/** Expéditeur SMTP, ou `null` si aucun serveur n'est configuré. */
export function smtpSender(settings: SmtpSettings): MailSender | null {
  if (!settings.host) return null;
  const transport = createSmtpTransport(settings);
  return async (message) => {
    const result = await transport.sendMail({ from: settings.from, ...message });
    if (result.rejected.length > 0) throw new Error("Adresse refusée par le serveur SMTP");
  };
}
