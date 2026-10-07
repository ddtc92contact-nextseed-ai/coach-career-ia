import "server-only";
import nodemailer from "nodemailer";
import { isSmtpConfigured, serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

type MagicLinkParams = { to: string; url: string; expires: Date };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function magicLinkEmail(url: string) {
  const host = new URL(url).host;
  const subject = "Votre lien de connexion à Coach Career IA";
  const text = [
    "Bonjour,",
    "",
    `Voici votre lien de connexion à ${host} (valable 15 minutes, utilisable une seule fois) :`,
    url,
    "",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="fr"><body style="font-family:system-ui,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
  <div style="max-width:480px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px;font-weight:600">Coach Career IA</p>
    <p>Bonjour,</p>
    <p>Cliquez sur le bouton ci-dessous pour vous connecter. Ce lien est valable 15 minutes et ne fonctionne qu'une fois.</p>
    <p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#1c1917;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Me connecter</a></p>
    <p style="font-size:13px;color:#78716c">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun compte ne sera ouvert sans clic sur ce lien.</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

/**
 * Envoie le lien magique par SMTP. Sans SMTP configuré, en développement
 * uniquement, le lien est affiché dans la console du serveur.
 */
export async function sendMagicLink({ to, url }: MagicLinkParams): Promise<void> {
  const env = serverEnv();

  if (!isSmtpConfigured(env)) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP non configuré : impossible d'envoyer le lien de connexion");
    }
    // Développement uniquement : affichage volontaire du lien dans la console.
    console.info(`\n[dev] Lien de connexion (SMTP non configuré) :\n${url}\n`);
    return;
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  const { subject, text, html } = magicLinkEmail(url);
  const result = await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text, html });
  if (result.rejected.length > 0) {
    throw new Error("Adresse refusée par le serveur SMTP");
  }
  logger.info("auth.magic_link.sent", { transport: "smtp" });
}
