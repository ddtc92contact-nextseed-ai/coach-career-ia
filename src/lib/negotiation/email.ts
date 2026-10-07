import { createTranslator } from "use-intl/core";
import { MESSAGES } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";
import type { MailMessage } from "@/lib/mail/smtp";

/**
 * Message de négociation tel que l'entreprise le reçoit, dans la langue de
 * l'offre. La mention de transparence (AI Act, art. 50 : rédigé par
 * l'assistant IA du candidat, approuvé par lui, rien n'est engagé sans sa
 * confirmation) et le lien de réponse sont ajoutés ICI, hors du texte
 * modifiable : ils sont toujours présents.
 */

export type ReplyLink = { replyUrl: string; expiresAt: Date };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function footer(locale: AppLocale, link: ReplyLink) {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: "email.negotiation",
  });
  const expires = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(link.expiresAt);
  return {
    t,
    disclosure: t("disclosure"),
    reply: t("replyText", { url: link.replyUrl }),
    expires: t("expires", { date: expires }),
  };
}

export function negotiationDisclosure(locale: AppLocale): string {
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: "email.negotiation",
  })("disclosure");
}

export function negotiationSubject(locale: AppLocale, offerTitle: string): string {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: "email.negotiation",
  });
  return t("subject", { title: offerTitle });
}

/** Texte à transmettre soi-même (offre sans adresse de candidature). */
export function negotiationPasteText(locale: AppLocale, body: string, link: ReplyLink): string {
  const f = footer(locale, link);
  return [body.trim(), "", "—", f.disclosure, "", f.reply, f.expires].join("\n");
}

export function negotiationEmail(
  locale: AppLocale,
  input: { offerTitle: string; body: string },
  link: ReplyLink,
): Omit<MailMessage, "to"> {
  const f = footer(locale, link);
  const text = [
    input.body.trim(),
    "",
    "—",
    f.disclosure,
    "",
    f.reply,
    f.expires,
    "",
    f.t("noReply"),
  ].join("\n");
  const paragraphs = input.body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `<!doctype html>
<html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
    ${paragraphs}
    <p style="margin:24px 0 8px;padding:12px;border-radius:8px;background:#f5f5f4;font-size:13px;color:#44403c">${escapeHtml(f.disclosure)}</p>
    <p style="margin:16px 0 8px"><a href="${escapeHtml(link.replyUrl)}" style="display:inline-block;background:#1c1917;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(f.t("replyButton"))}</a></p>
    <p style="font-size:13px;color:#78716c">${escapeHtml(f.expires)}<br>${escapeHtml(f.t("noReply"))}</p>
  </div>
</body></html>`;
  return {
    subject: negotiationSubject(locale, input.offerTitle),
    text,
    html,
    headers: { "X-AI-Generated": "ai-drafted; human-approved" },
  };
}
