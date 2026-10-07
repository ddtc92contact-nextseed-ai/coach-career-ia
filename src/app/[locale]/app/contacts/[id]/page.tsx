import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { DeleteButton } from "@/components/delete-button";
import { Link } from "@/i18n/navigation";
import { LOCALE_NAMES } from "@/i18n/routing";
import { requireUser } from "@/lib/auth/session";
import { isLinkActive } from "@/lib/card/tokens";
import { getContact, markRepliesRead } from "@/lib/contact/repository";
import { experienceRoles, getHandoverState } from "@/lib/handover/repository";
import { discardContactAction, markSubmittedAction, revokeHandoverAction } from "../actions";
import { CopyText, DraftPanel } from "./draft-panel";
import { HandoverPanel } from "./handover-panel";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contacts");
  return { title: t("title") };
}

const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";

export default async function ContactPage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  // Contact d'une autre personne (ou identifiant inventé) : 404.
  const contact = await getContact(user.id, id);
  if (!contact) notFound();
  if (contact.replies.some((r) => !r.readAt)) await markRepliesRead(user.id, contact.id);

  const sent = contact.status === "SENT" || contact.status === "SENDING";
  const [t, tc, th, format, handover, roles] = await Promise.all([
    getTranslations("contacts.detail"),
    getTranslations("contacts"),
    getTranslations("handover"),
    getFormatter(),
    getHandoverState(user.id, contact.id),
    sent && contact.replies.length > 0 ? experienceRoles(user.id) : Promise.resolve({}),
  ]);
  const fieldList = (fields: string[]) =>
    format.list(fields.map((f) => th(`fieldNames.${f as "name"}`)));
  const linkActive = contact.cardLink ? isLinkActive(contact.cardLink, new Date()) : false;

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/app/contacts" className="text-sm text-stone-600 hover:underline">
        {t("back")}
      </Link>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={contact.status === "SENT" ? "proven" : "neutral"}>
            {tc(`status.${contact.status}`)}
          </Badge>
          <Badge>{tc(`channel.${contact.channel}`)}</Badge>
          {sent ? (
            <Badge tone={handover.active ? "proven" : "neutral"}>
              {handover.active ? th("status.revealed") : th("status.anonymous")}
            </Badge>
          ) : null}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight break-words">
          {contact.offer.title}
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          {contact.offer.companyName ?? tc("companyUnknown")}
        </p>
        <p className="mt-2 text-sm text-stone-600">
          {contact.channel === "EMAIL"
            ? contact.offer.recipient
              ? t("recipient", { email: contact.offer.recipient })
              : t("recipientHidden")
            : contact.channel === "PORTAL"
              ? t("recipientPortal")
              : null}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {contact.channel === "APPLY_URL" && contact.offer.applyUrl ? (
            <a
              href={contact.offer.applyUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline"
            >
              {t("applyPage")}
            </a>
          ) : null}
          <a
            href={contact.offer.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-stone-600 underline"
          >
            {t("original")}
          </a>
          {contact.offer.matchId ? (
            <Link
              href={`/app/opportunites/${contact.offer.matchId}`}
              className="text-stone-600 underline"
            >
              {t("opportunity")}
            </Link>
          ) : null}
        </p>
        {!contact.offer.open ? (
          <p className="mt-2 text-sm text-amber-800">{t("offerClosed")}</p>
        ) : null}
      </header>

      {sent ? (
        <section className={sectionClass} aria-labelledby="envoye">
          <h2 id="envoye" className="text-lg font-semibold">
            {t("sentText")}
          </h2>
          {contact.sentAt ? (
            <p className="mt-1 text-sm text-stone-600">
              {tc(contact.channel === "APPLY_URL" ? "submittedOn" : "sentOn", {
                date: format.dateTime(contact.sentAt, "short"),
              })}
            </p>
          ) : null}
          <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm font-medium [overflow-wrap:anywhere] break-words">
            {contact.subject}
          </p>
          <p className="mt-2 rounded-lg bg-stone-50 p-3 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-line text-stone-800">
            {contact.sentText ?? contact.body}
          </p>
        </section>
      ) : (
        <section className={`${sectionClass} space-y-4`} aria-labelledby="brouillon">
          <h2 id="brouillon" className="sr-only">
            {t("body")}
          </h2>
          <p className="text-sm text-stone-600">
            {contact.draftSource === "llm" ? t("draftLlm") : t("draftRules")}{" "}
            {t("language", { language: LOCALE_NAMES[contact.locale] })}
          </p>
          {contact.approved && contact.approvedAt ? (
            <p role="status" className="bg-brand-50 text-brand-800 rounded-lg px-3 py-2 text-sm">
              {t("approvedOn", { date: format.dateTime(contact.approvedAt, "short") })}
            </p>
          ) : null}
          {/* Remonté à chaque changement : les champs suivent le texte enregistré. */}
          <DraftPanel
            key={`${contact.status}:${contact.subject}:${contact.body}`}
            id={contact.id}
            channel={contact.channel}
            subject={contact.subject}
            body={contact.body}
            approved={contact.approved}
          />
          {contact.channel === "APPLY_URL" && contact.approved && contact.sentText ? (
            <div className="space-y-3 border-t border-stone-100 pt-4">
              <h3 className="font-semibold">{t("paste")}</h3>
              <p className="text-sm text-stone-600">{t("pasteHint")}</p>
              <CopyText text={contact.sentText} />
              <form action={markSubmittedAction.bind(null, contact.id)}>
                <button
                  type="submit"
                  className="w-full rounded-lg bg-stone-900 px-5 py-2.5 font-medium text-white hover:bg-stone-700 sm:w-auto"
                >
                  {t("markSubmitted")}
                </button>
              </form>
            </div>
          ) : null}
          <div className="border-t border-stone-100 pt-4">
            <DeleteButton
              action={discardContactAction.bind(null, contact.id)}
              confirmMessage={t("discardConfirm")}
              label={t("discard")}
              small
            />
          </div>
        </section>
      )}

      {contact.cardLink && (sent || contact.channel === "APPLY_URL") ? (
        <p className="text-sm text-stone-600">
          {linkActive
            ? t(contact.channel === "PORTAL" ? "portalCard" : "link", {
                date: format.dateTime(contact.cardLink.expiresAt, "short"),
                views: contact.cardLink.viewCount,
              })
            : t(contact.channel === "PORTAL" ? "portalCardRevoked" : "linkRevoked")}
        </p>
      ) : null}

      {sent ? (
        <section className={sectionClass} aria-labelledby="reponses">
          <h2 id="reponses" className="text-lg font-semibold">
            {t("replies")}
          </h2>
          {contact.replies.length === 0 ? (
            <p className="mt-2 text-sm text-stone-600">{t("noReply")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {contact.replies.map((r) => (
                <li key={r.id} className="rounded-lg border border-stone-200 p-3">
                  <p className="text-xs text-stone-500">
                    {t(r.closing ? "closedOn" : "receivedOn", {
                      date: format.dateTime(r.createdAt, "short"),
                    })}
                  </p>
                  <p className="mt-1 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-line text-stone-800">
                    {r.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {sent ? (
        <section className={`${sectionClass} space-y-4`} aria-labelledby="anonymat">
          <h2 id="anonymat" className="text-lg font-semibold">
            {th("title")}
          </h2>
          {handover.active ? (
            <div className="space-y-3">
              <p className="bg-brand-50 text-brand-800 rounded-lg px-3 py-2 text-sm">
                {th("active", {
                  date: format.dateTime(handover.active.createdAt, "short"),
                  fields: fieldList(handover.active.fields),
                })}
              </p>
              <p className="text-sm text-stone-600">
                {th(contact.channel === "PORTAL" ? "activePortal" : "activeLink", {
                  date: format.dateTime(handover.active.expiresAt, "short"),
                  views: handover.active.viewCount,
                })}
              </p>
              <DeleteButton
                action={revokeHandoverAction.bind(null, contact.id)}
                confirmMessage={th("revokeConfirm")}
                label={th("revoke")}
                small
              />
            </div>
          ) : contact.closedAt ? (
            <p className="text-sm text-stone-600">{th("closed")}</p>
          ) : contact.replies.length === 0 ? (
            <p className="text-sm text-stone-600">{th("waitReply")}</p>
          ) : null}
          {contact.replies.length > 0 && !contact.closedAt ? (
            <HandoverPanel
              contactId={contact.id}
              active={Boolean(handover.active)}
              channel={contact.channel}
              companyName={contact.offer.companyName}
              roles={roles}
            />
          ) : null}
          {handover.events.length > 0 ? (
            <div className="border-t border-stone-100 pt-4">
              <h3 className="text-sm font-semibold">{th("logTitle")}</h3>
              <ul className="mt-2 space-y-1 text-sm text-stone-700">
                {handover.events.map((e) => (
                  <li key={e.id}>
                    {th(`log.${e.type}`, {
                      date: format.dateTime(e.createdAt, "short"),
                      fields: fieldList(e.fields),
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
