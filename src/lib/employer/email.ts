import { createTranslator } from "use-intl/core";
import { MESSAGES } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";
import type { MailMessage } from "@/lib/mail/smtp";

/**
 * E-mails aux membres d'une organisation : décisions de modération
 * (organisation validée, refusée ou suspendue ; offre approuvée ou refusée,
 * avec le motif saisi par l'administrateur). Dans la langue du membre.
 */

export const EMPLOYER_EMAILS = [
  "orgApproved",
  "orgRejected",
  "orgSuspended",
  "postingApproved",
  "postingRejected",
] as const;
export type EmployerEmailKind = (typeof EMPLOYER_EMAILS)[number];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function employerEmail(
  locale: AppLocale,
  kind: EmployerEmailKind,
  input: { orgName: string; title?: string; reason?: string | null; url: string },
): Omit<MailMessage, "to"> {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email.employer" });
  const values = { org: input.orgName, title: input.title ?? "" };
  const subject = t(`${kind}.subject`, values);
  const body = t(`${kind}.body`, values);
  const reason = input.reason ? t("reason", { reason: input.reason }) : null;
  const text = [
    t("greeting"),
    "",
    body,
    ...(reason ? ["", reason] : []),
    "",
    t("dashboardText", { url: input.url }),
    "",
    t("signature"),
  ].join("\n");
  const html = `<!doctype html>
<html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px;font-weight:600">${escapeHtml(t("brand"))}</p>
    <p>${escapeHtml(t("greeting"))}</p>
    <p>${escapeHtml(body)}</p>
    ${reason ? `<p style="padding:12px;border-radius:8px;background:#f5f5f4;color:#44403c">${escapeHtml(reason)}</p>` : ""}
    <p style="margin:24px 0"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#1c1917;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("dashboard"))}</a></p>
    <p style="font-size:13px;color:#78716c">${escapeHtml(t("signature"))}</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

/**
 * Notification aux membres : une prise de contact anonyme est arrivée dans la
 * messagerie de l'espace entreprise. AUCUNE donnée candidat (ni carte, ni
 * message, ni compétence) : seulement l'intitulé de l'offre de l'organisation
 * et le lien vers le fil, qui exige d'être connecté comme membre.
 */
export function portalContactEmail(
  locale: AppLocale,
  input: { title: string; url: string },
): Omit<MailMessage, "to"> {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email.employer" });
  const subject = t("portalContact.subject", { title: input.title });
  const body = t("portalContact.body", { title: input.title });
  const text = [
    t("greeting"),
    "",
    body,
    "",
    t("portalContact.openText", { url: input.url }),
    "",
    t("signature"),
  ].join("\n");
  const html = `<!doctype html>
<html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px;font-weight:600">${escapeHtml(t("brand"))}</p>
    <p>${escapeHtml(t("greeting"))}</p>
    <p>${escapeHtml(body)}</p>
    <p style="margin:24px 0"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#1c1917;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("portalContact.open"))}</a></p>
    <p style="font-size:13px;color:#78716c">${escapeHtml(t("portalContact.privacy"))}</p>
    <p style="font-size:13px;color:#78716c">${escapeHtml(t("signature"))}</p>
  </div>
</body></html>`;
  return { subject, text, html };
}
