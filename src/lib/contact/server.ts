import "server-only";
import { getAiClient, isAiConfigured } from "@/lib/ai/server";
import { smtpSender, smtpSettingsFromEnv, type MailSender } from "@/lib/mail/smtp";
import { matchingConfig } from "@/lib/matching/config";

/**
 * Dépendances des prises de contact dans l'application (remplacées par des
 * doublures dans les tests) :
 * - `send` : SMTP de l'application, depuis l'adresse de la PLATEFORME
 *   (`CONTACT_EMAIL_FROM`, sinon `EMAIL_FROM`) — jamais celle du candidat ;
 * - `notify` : SMTP habituel (`EMAIL_FROM`), pour prévenir le candidat ;
 * - `appUrl` : URL publique des liens (`APP_URL`, sinon `AUTH_URL`).
 */

let senders: { send: MailSender | null; notify: MailSender | null } | undefined;

function mailers() {
  if (!senders) {
    const settings = smtpSettingsFromEnv();
    const from = process.env.CONTACT_EMAIL_FROM?.trim() || settings.from;
    senders = { send: smtpSender({ ...settings, from }), notify: smtpSender(settings) };
  }
  return senders;
}

export function contactDeps() {
  return {
    send: mailers().send,
    notify: mailers().notify,
    appUrl: matchingConfig().appUrl,
    ai: isAiConfigured() ? getAiClient() : null,
  };
}
