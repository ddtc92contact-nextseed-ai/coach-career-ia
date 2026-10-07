import { createTranslator } from "use-intl/core";
import { MESSAGES } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";
import type { MailMessage } from "@/lib/mail/smtp";

/**
 * Message final envoyé à l'entreprise (ou à coller sur sa page « Postuler »),
 * dans la langue de l'offre. Les mentions obligatoires sont ajoutées ici, en
 * dehors du texte rédigé par l'IA et modifiable par le candidat :
 * - transparence (AI Act, art. 50) : message préparé par un agent IA pour le
 *   compte d'une personne candidate anonyme, relu et approuvé par elle ;
 * - lien vers la carte anonyme et vers la page de réponse (sans identité) ;
 * - date d'expiration des liens.
 */

export type ContactLinks = { cardUrl: string; replyUrl: string; expiresAt: Date };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function footerLines(locale: AppLocale, links: ContactLinks) {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email.contact" });
  const expires = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(links.expiresAt);
  return {
    t,
    disclosure: t("disclosure"),
    card: t("cardText", { url: links.cardUrl }),
    reply: t("replyText", { url: links.replyUrl }),
    expires: t("expires", { date: expires }),
  };
}

/** Texte à coller par le candidat sur la page « Postuler » de l'offre. */
export function pasteText(locale: AppLocale, body: string, links: ContactLinks): string {
  const f = footerLines(locale, links);
  return [body.trim(), "", "—", f.disclosure, "", f.card, f.reply, f.expires].join("\n");
}

/** E-mail envoyé à l'adresse de candidature de l'offre (sans le destinataire). */
export function contactEmail(
  locale: AppLocale,
  draft: { subject: string; body: string },
  links: ContactLinks,
): Omit<MailMessage, "to"> {
  const f = footerLines(locale, links);
  const text = [
    draft.body.trim(),
    "",
    "—",
    f.disclosure,
    "",
    f.card,
    f.reply,
    f.expires,
    "",
    f.t("noReply"),
  ].join("\n");
  const paragraphs = draft.body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `<!doctype html>
<html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
    ${paragraphs}
    <p style="margin:24px 0 8px;padding:12px;border-radius:8px;background:#f5f5f4;font-size:13px;color:#44403c">${escapeHtml(f.disclosure)}</p>
    <p style="margin:16px 0 8px"><a href="${escapeHtml(links.cardUrl)}" style="display:inline-block;background:#1c1917;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(f.t("cardButton"))}</a>
      <a href="${escapeHtml(links.replyUrl)}" style="display:inline-block;margin-left:8px;color:#1c1917">${escapeHtml(f.t("replyButton"))}</a></p>
    <p style="font-size:13px;color:#78716c">${escapeHtml(f.expires)}<br>${escapeHtml(f.t("noReply"))}</p>
  </div>
</body></html>`;
  return {
    subject: draft.subject,
    text,
    html,
    headers: {
      // Message préparé par un agent IA, approuvé par une personne (AI Act, art. 50).
      "X-AI-Generated": "ai-drafted; human-approved",
    },
  };
}

/** Notification au candidat : une entreprise a répondu (sans le contenu de la réponse). */
export function replyNotificationEmail(
  locale: AppLocale,
  input: { offerTitle: string; inboxUrl: string },
): Omit<MailMessage, "to"> {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email.reply" });
  const text = [
    t("intro", { title: input.offerTitle }),
    "",
    t("viewText", { url: input.inboxUrl }),
    "",
    t("privacy"),
  ].join("\n");
  const html = `<!doctype html>
<html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px;font-weight:600">${escapeHtml(t("brand"))}</p>
    <p>${escapeHtml(t("intro", { title: input.offerTitle }))}</p>
    <p style="margin:24px 0"><a href="${escapeHtml(input.inboxUrl)}" style="display:inline-block;background:#1c1917;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(t("view"))}</a></p>
    <p style="font-size:13px;color:#78716c">${escapeHtml(t("privacy"))}</p>
  </div>
</body></html>`;
  return { subject: t("subject"), text, html };
}
