import "server-only";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/routing";
import { db } from "@/lib/db";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import type { MailSender } from "@/lib/mail/smtp";
import { portalContactEmail, type PortalEmailKind } from "./email";

/** Chemin d'un fil de la messagerie de l'espace entreprise. */
export const threadPath = (locale: string, contactId: string) =>
  `/${locale}/entreprise/messages/${contactId}`;

/**
 * Prévient chaque membre de l'organisation (dans sa langue) qu'une prise de
 * contact anonyme est arrivée. Sans SMTP, le fil reste dans la messagerie.
 * Un échec d'envoi n'annule rien. Journal : nombre de destinataires seulement.
 */
export function notifyPortalContact(
  input: { orgId: string; contactId: string; offerTitle: string },
  deps: NotifyDeps,
): Promise<void> {
  return notifyMembers("portalContact", input, deps);
}

/** Nouveau message de la personne candidate dans un fil existant (négociation). */
export function notifyPortalMessage(
  input: { orgId: string; contactId: string; offerTitle: string },
  deps: NotifyDeps,
): Promise<void> {
  return notifyMembers("portalMessage", input, deps);
}

type NotifyDeps = { send: MailSender | null | undefined; appUrl: string | null; logger?: Logger };

async function notifyMembers(
  kind: PortalEmailKind,
  input: { orgId: string; contactId: string; offerTitle: string },
  deps: NotifyDeps,
): Promise<void> {
  const log = deps.logger ?? defaultLogger;
  if (!deps.send || !deps.appUrl) return;
  const members = await db.organizationMember.findMany({
    where: { orgId: input.orgId },
    select: { user: { select: { email: true, locale: true } } },
    take: 50,
  });
  let failed = 0;
  for (const { user } of members) {
    const locale = isAppLocale(user.locale) ? user.locale : DEFAULT_LOCALE;
    try {
      await deps.send({
        to: user.email,
        ...portalContactEmail(
          locale,
          { title: input.offerTitle, url: `${deps.appUrl}${threadPath(locale, input.contactId)}` },
          kind,
        ),
      });
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) log.error("employer.inbox.notify_failed", { failed });
  log.info("employer.inbox.notified", { members: members.length - failed });
}
