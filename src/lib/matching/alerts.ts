import { randomBytes } from "node:crypto";
import { createTranslator } from "use-intl/core";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AlertFrequency } from "@/generated/prisma/enums";
import { MESSAGES } from "@/i18n/messages";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import type { MailMessage, MailSender } from "@/lib/mail/smtp";

/**
 * Alertes : résumé par e-mail des nouvelles correspondances au-dessus du
 * seuil choisi par le candidat (désactivées / quotidiennes / hebdomadaires),
 * dans sa langue, avec un lien de désabonnement.
 *
 * CONTENU : uniquement des informations sur les offres (intitulé, entreprise,
 * lieu, score, liens). Rien de la mémoire de carrière ni des garde-fous :
 * seule l'adresse du destinataire l'identifie.
 */

export const ALERT_FREQUENCIES = [
  "OFF",
  "DAILY",
  "WEEKLY",
] as const satisfies readonly AlertFrequency[];
export const ALERT_MIN_SCORES = [50, 60, 70, 80, 90] as const;
const MAX_ITEMS = 20;
const HOUR = 3_600_000;

/** Un résumé est dû si le précédent date d'au moins 1 jour / 7 jours (1 h de marge). */
export function alertDue(frequency: AlertFrequency, lastSentAt: Date | null, now: Date): boolean {
  if (frequency === "OFF") return false;
  if (!lastSentAt) return true;
  const period = frequency === "DAILY" ? 24 * HOUR : 7 * 24 * HOUR;
  return now.getTime() - lastSentAt.getTime() >= period - HOUR;
}

export type AlertItem = {
  matchId: string;
  title: string;
  companyName: string | null;
  city: string | null;
  score: number;
  url: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function alertEmail(input: {
  locale: AppLocale;
  frequency: Exclude<AlertFrequency, "OFF">;
  appUrl: string;
  unsubscribeUrl: string;
  /** Désabonnement en un clic (RFC 8058), appelé en POST par le client de messagerie. */
  oneClickUrl: string;
  items: AlertItem[];
}): Omit<MailMessage, "to"> {
  const { locale, appUrl, items } = input;
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email.alerts" });
  const count = items.length;
  const detailUrl = (item: AlertItem) => `${appUrl}/${locale}/app/opportunites/${item.matchId}`;
  const line = (item: AlertItem) =>
    [item.companyName ?? t("companyUnknown"), item.city].filter(Boolean).join(" · ");

  const text = [
    t("intro", { count }),
    "",
    ...items.flatMap((item) => [
      `• ${item.title} — ${line(item)} — ${t("score", { score: item.score })}`,
      `  ${t("view")} : ${detailUrl(item)}`,
      `  ${t("original")} : ${item.url}`,
      "",
    ]),
    t("footer", { frequency: input.frequency }),
    t("unsubscribeText", { url: input.unsubscribeUrl }),
  ].join("\n");

  const rows = items
    .map(
      (item) => `
    <li style="margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid #e7e5e4;list-style:none">
      <p style="margin:0;font-weight:600">${escapeHtml(item.title)}</p>
      <p style="margin:4px 0;color:#57534e;font-size:14px">${escapeHtml(line(item))} · ${escapeHtml(t("score", { score: item.score }))}</p>
      <p style="margin:8px 0 0;font-size:14px"><a href="${escapeHtml(detailUrl(item))}" style="color:#1c1917">${escapeHtml(t("view"))}</a> · <a href="${escapeHtml(item.url)}" style="color:#57534e">${escapeHtml(t("original"))}</a></p>
    </li>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="${locale}"><body style="font-family:system-ui,sans-serif;color:#1c1917;background:#fafaf9;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px;font-weight:600">${escapeHtml(t("brand"))}</p>
    <p>${escapeHtml(t("intro", { count }))}</p>
    <ul style="padding:0;margin:24px 0">${rows}</ul>
    <p style="font-size:13px;color:#78716c">${escapeHtml(t("footer", { frequency: input.frequency }))}
      <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#78716c">${escapeHtml(t("unsubscribe"))}</a></p>
  </div>
</body></html>`;

  return {
    subject: t("subject", { count }),
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${input.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export const unsubscribePageUrl = (appUrl: string, locale: AppLocale, token: string) =>
  `${appUrl}/${locale}/alertes/desabonnement?token=${encodeURIComponent(token)}`;

export const oneClickUnsubscribeUrl = (appUrl: string, token: string) =>
  `${appUrl}/api/alerts/unsubscribe?token=${encodeURIComponent(token)}`;

export type AlertsDeps = {
  send: MailSender;
  appUrl: string;
  now?: () => Date;
  logger?: Logger;
};

/**
 * Envoie les résumés dus. Un candidat dont le matching est en attente de
 * recalcul (garde-fous tout juste modifiés) est reporté au passage suivant.
 * Renvoie le nombre d'e-mails envoyés.
 */
export async function runAlerts(prisma: PrismaClient, deps: AlertsDeps): Promise<number> {
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();
  const states = await prisma.matchingState.findMany({
    where: { alertFrequency: { not: "OFF" }, dirtyAt: null },
    select: {
      userId: true,
      alertFrequency: true,
      alertMinScore: true,
      alertSentAt: true,
      alertToken: true,
      user: { select: { email: true, locale: true } },
    },
  });
  let sent = 0;
  for (const state of states) {
    if (state.alertFrequency === "OFF" || !alertDue(state.alertFrequency, state.alertSentAt, now)) {
      continue;
    }
    const matches = await prisma.match.findMany({
      where: {
        userId: state.userId,
        status: "NEW",
        notifiedAt: null,
        score: { gte: state.alertMinScore },
        offer: { status: "OPEN", duplicateOfId: null },
      },
      orderBy: [{ score: "desc" }, { computedAt: "desc" }],
      take: MAX_ITEMS,
      select: {
        id: true,
        score: true,
        offer: { select: { title: true, companyName: true, city: true, url: true } },
      },
    });
    if (matches.length === 0) continue;

    const locale = isAppLocale(state.user.locale) ? state.user.locale : DEFAULT_LOCALE;
    let token = state.alertToken;
    if (!token) {
      token = randomBytes(24).toString("base64url");
      await prisma.matchingState.update({
        where: { userId: state.userId },
        data: { alertToken: token },
      });
    }
    const message = alertEmail({
      locale,
      frequency: state.alertFrequency,
      appUrl: deps.appUrl,
      unsubscribeUrl: unsubscribePageUrl(deps.appUrl, locale, token),
      oneClickUrl: oneClickUnsubscribeUrl(deps.appUrl, token),
      items: matches.map((m) => ({
        matchId: m.id,
        title: m.offer.title,
        companyName: m.offer.companyName,
        city: m.offer.city,
        score: m.score,
        url: m.offer.url,
      })),
    });
    try {
      await deps.send({ to: state.user.email, ...message });
    } catch (error) {
      log.error("matching.alerts.send_failed", {
        error: error instanceof Error ? error.name : "erreur",
      });
      continue;
    }
    await prisma.$transaction([
      prisma.match.updateMany({
        where: { id: { in: matches.map((m) => m.id) }, userId: state.userId },
        data: { notifiedAt: now },
      }),
      prisma.matchingState.update({ where: { userId: state.userId }, data: { alertSentAt: now } }),
    ]);
    sent++;
    log.info("matching.alerts.sent", { items: matches.length, locale });
  }
  return sent;
}

/** Désabonnement par jeton (lien de l'e-mail). Vrai si un abonnement a été désactivé. */
export async function unsubscribeAlerts(prisma: PrismaClient, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const { count } = await prisma.matchingState.updateMany({
    where: { alertToken: token },
    data: { alertFrequency: "OFF" },
  });
  return count > 0;
}
