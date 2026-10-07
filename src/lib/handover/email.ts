import { createTranslator } from "use-intl/core";
import { MESSAGES } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";
import type { MailMessage } from "@/lib/mail/smtp";

/**
 * E-mail à l'entreprise : la personne candidate lève son anonymat. Il ne
 * contient AUCUNE donnée d'identité, seulement le lien (révocable, expirant)
 * vers le profil révélé : révoquer le lien retire vraiment l'accès.
 * Transparence : envoyé par l'agent de carrière IA, sur décision explicite
 * de la personne candidate.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function handoverEmail(
  locale: AppLocale,
  input: { offerTitle: string; url: string; expiresAt: Date },
): Omit<MailMessage, "to"> {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email.handover" });
  const expires = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(input.expiresAt);
  const intro = t("intro", { title: input.offerTitle });
  const text = [
    intro,
    "",
    t("viewText", { url: input.url }),
    t("expires", { date: expires }),
    "",
    t("disclosure"),
    "",
    t("noReply"),
  ].join("\n");
  const html = `<!doctype html>
<html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px">${escapeHtml(intro)}</p>
    <p style="margin:24px 0"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#1c1917;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("view"))}</a></p>
    <p style="font-size:13px;color:#44403c">${escapeHtml(t("expires", { date: expires }))}</p>
    <p style="margin:24px 0 8px;padding:12px;border-radius:8px;background:#f5f5f4;font-size:13px;color:#44403c">${escapeHtml(t("disclosure"))}</p>
    <p style="font-size:13px;color:#78716c">${escapeHtml(t("noReply"))}</p>
  </div>
</body></html>`;
  return {
    subject: t("subject", { title: input.offerTitle }),
    text,
    html,
    headers: {
      // Envoyé par un agent IA, sur décision explicite d'une personne (AI Act, art. 50).
      "X-AI-Generated": "ai-agent; human-decided",
    },
  };
}
