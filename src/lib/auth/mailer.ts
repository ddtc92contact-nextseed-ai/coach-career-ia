import "server-only";
import { createTranslator } from "next-intl";
import { MESSAGES } from "@/i18n/messages";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";
import { isSmtpConfigured, serverEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createSmtpTransport } from "@/lib/mail/smtp";

type MagicLinkParams = { to: string; url: string; expires: Date; locale: AppLocale };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Langue d'un lien magique : celle de sa destination (`callbackUrl=/en/app`),
 * c'est-à-dire la langue de la page où le lien a été demandé.
 */
export function magicLinkLocale(url: string): AppLocale | undefined {
  try {
    const callbackUrl = new URL(url).searchParams.get("callbackUrl") ?? "";
    const pathname = new URL(callbackUrl, "http://local").pathname;
    const candidate = pathname.split("/")[1];
    return isAppLocale(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function magicLinkEmail(url: string, locale: AppLocale = DEFAULT_LOCALE) {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email.magicLink" });
  const host = new URL(url).host;
  const subject = t("subject");
  const text = [t("greeting"), "", t("textIntro", { host }), url, "", t("ignore")].join("\n");
  const html = `<!doctype html>
<html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
  <div style="max-width:480px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px;font-weight:600">${escapeHtml(t("brand"))}</p>
    <p>${escapeHtml(t("greeting"))}</p>
    <p>${escapeHtml(t("htmlIntro"))}</p>
    <p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#1c1917;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(t("button"))}</a></p>
    <p style="font-size:13px;color:#78716c">${escapeHtml(t("htmlIgnore"))}</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

/**
 * Envoie le lien magique par SMTP, dans la langue de l'utilisateur. Sans SMTP
 * configuré, en développement uniquement, le lien est affiché dans la console
 * du serveur.
 */
export async function sendMagicLink({ to, url, locale }: MagicLinkParams): Promise<void> {
  const env = serverEnv();

  if (!isSmtpConfigured(env)) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP non configuré : impossible d'envoyer le lien de connexion");
    }
    // Développement uniquement : affichage volontaire du lien dans la console.
    console.info(`\n[dev] Lien de connexion (SMTP non configuré, langue ${locale}) :\n${url}\n`);
    return;
  }

  const transport = createSmtpTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.EMAIL_FROM,
  });
  const { subject, text, html } = magicLinkEmail(url, locale);
  const result = await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text, html });
  if (result.rejected.length > 0) {
    throw new Error("Adresse refusée par le serveur SMTP");
  }
  logger.info("auth.magic_link.sent", { transport: "smtp", locale });
}
