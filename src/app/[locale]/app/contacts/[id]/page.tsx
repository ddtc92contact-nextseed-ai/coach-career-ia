import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { DeleteButton } from "@/components/delete-button";
import { Link } from "@/i18n/navigation";
import { LOCALE_NAMES } from "@/i18n/routing";
import { requireUser } from "@/lib/auth/session";
import { hasFeature } from "@/lib/billing/entitlements";
import { getEntitlements } from "@/lib/billing/server";
import { isLinkActive } from "@/lib/card/tokens";
import { getContact, markRepliesRead } from "@/lib/contact/repository";
import { experienceRoles, getHandoverState } from "@/lib/handover/repository";
import { getNegotiation } from "@/lib/negotiation/repository";
import { discardContactAction, markSubmittedAction, revokeHandoverAction } from "../actions";
import { CopyText, DraftPanel } from "./draft-panel";
import { HandoverPanel } from "./handover-panel";
import { NegotiationSection } from "./negotiation-section";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/** Onglet « Négocier » : `?onglet=negocier`. */
const NEGOTIATION_TAB = "negocier";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contacts");
  return { title: t("title") };
}

const sectionClass = "rounded-2xl border border-line bg-surface p-4 sm:p-6";

export default async function ContactPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const [{ id }, query = {}] = await Promise.all([params, searchParams]);
  // Contact d'une autre personne (ou identifiant inventé) : 404.
  const contact = await getContact(user.id, id);
  if (!contact) notFound();
  if (contact.replies.some((r) => !r.readAt)) await markRepliesRead(user.id, contact.id);

  const sent = contact.status === "SENT" || contact.status === "SENDING";
  const negotiate = contact.status === "SENT" && query.onglet === NEGOTIATION_TAB;
  if (negotiate) {
    const [view, entitlements, t, tn, tc] = await Promise.all([
      getNegotiation(user.id, contact.id),
      getEntitlements(user.id),
      getTranslations("contacts.detail"),
      getTranslations("negotiation"),
      getTranslations("contacts"),
    ]);
    return (
      <div className="max-w-3xl space-y-6">
        <Link href="/app/contacts" className="text-ink-muted text-sm hover:underline">
          {t("back")}
        </Link>
        <header>
          <h1 className="text-2xl font-semibold tracking-tight break-words">
            {contact.offer.title}
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            {contact.offer.companyName ?? tc("companyUnknown")}
          </p>
        </header>
        <ContactTabs id={contact.id} active="negotiation" labels={tn} />
        <NegotiationSection view={view} canGenerate={hasFeature(entitlements, "negotiation")} />
      </div>
    );
  }
  const [t, tc, th, tn, format, handover, roles] = await Promise.all([
    getTranslations("contacts.detail"),
    getTranslations("contacts"),
    getTranslations("handover"),
    getTranslations("negotiation"),
    getFormatter(),
    getHandoverState(user.id, contact.id),
    sent && contact.replies.length > 0 ? experienceRoles(user.id) : Promise.resolve({}),
  ]);
  const fieldList = (fields: string[]) =>
    format.list(fields.map((f) => th(`fieldNames.${f as "name"}`)));
  const linkActive = contact.cardLink ? isLinkActive(contact.cardLink, new Date()) : false;

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/app/contacts" className="text-ink-muted text-sm hover:underline">
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
        <p className="text-ink-muted mt-1 text-sm">
          {contact.offer.companyName ?? tc("companyUnknown")}
        </p>
        <p className="text-ink-muted mt-2 text-sm">
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
            className="text-ink-muted underline"
          >
            {t("original")}
          </a>
          {contact.offer.matchId ? (
            <Link
              href={`/app/opportunites/${contact.offer.matchId}`}
              className="text-ink-muted underline"
            >
              {t("opportunity")}
            </Link>
          ) : null}
        </p>
        {!contact.offer.open ? (
          <p className="text-warning-ink mt-2 text-sm">{t("offerClosed")}</p>
        ) : null}
      </header>

      {contact.status === "SENT" ? (
        <ContactTabs id={contact.id} active="followUp" labels={tn} />
      ) : null}

      {sent ? (
        <section className={sectionClass} aria-labelledby="envoye">
          <h2 id="envoye" className="text-lg font-semibold">
            {t("sentText")}
          </h2>
          {contact.sentAt ? (
            <p className="text-ink-muted mt-1 text-sm">
              {tc(contact.channel === "APPLY_URL" ? "submittedOn" : "sentOn", {
                date: format.dateTime(contact.sentAt, "short"),
              })}
            </p>
          ) : null}
          <p className="bg-subtle mt-3 rounded-lg p-3 text-sm font-medium [overflow-wrap:anywhere] break-words">
            {contact.subject}
          </p>
          <p className="bg-subtle text-ink mt-2 rounded-lg p-3 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-line">
            {contact.sentText ?? contact.body}
          </p>
        </section>
      ) : (
        <section className={`${sectionClass} space-y-4`} aria-labelledby="brouillon">
          <h2 id="brouillon" className="sr-only">
            {t("body")}
          </h2>
          <p className="text-ink-muted text-sm">
            {contact.draftSource === "llm" ? t("draftLlm") : t("draftRules")}{" "}
            {t("language", { language: LOCALE_NAMES[contact.locale] })}
          </p>
          {contact.approved && contact.approvedAt ? (
            <p role="status" className="bg-brand-soft text-brand-ink rounded-lg px-3 py-2 text-sm">
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
            <div className="border-line space-y-3 border-t pt-4">
              <h3 className="font-semibold">{t("paste")}</h3>
              <p className="text-ink-muted text-sm">{t("pasteHint")}</p>
              <CopyText text={contact.sentText} />
              <form action={markSubmittedAction.bind(null, contact.id)}>
                <button
                  type="submit"
                  className="bg-primary text-on-primary hover:bg-primary-hover w-full rounded-lg px-5 py-2.5 font-medium sm:w-auto"
                >
                  {t("markSubmitted")}
                </button>
              </form>
            </div>
          ) : null}
          <div className="border-line border-t pt-4">
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
        <p className="text-ink-muted text-sm">
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
            <p className="text-ink-muted mt-2 text-sm">{t("noReply")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {contact.replies.map((r) => (
                <li key={r.id} className="border-line rounded-lg border p-3">
                  <p className="text-ink-subtle text-xs">
                    {t(r.closing ? "closedOn" : "receivedOn", {
                      date: format.dateTime(r.createdAt, "short"),
                    })}
                  </p>
                  <p className="text-ink mt-1 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-line">
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
              <p className="bg-brand-soft text-brand-ink rounded-lg px-3 py-2 text-sm">
                {th("active", {
                  date: format.dateTime(handover.active.createdAt, "short"),
                  fields: fieldList(handover.active.fields),
                })}
              </p>
              <p className="text-ink-muted text-sm">
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
            <p className="text-ink-muted text-sm">{th("closed")}</p>
          ) : contact.replies.length === 0 ? (
            <p className="text-ink-muted text-sm">{th("waitReply")}</p>
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
            <div className="border-line border-t pt-4">
              <h3 className="text-sm font-semibold">{th("logTitle")}</h3>
              <ul className="text-ink-muted mt-2 space-y-1 text-sm">
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

/** Onglets « Suivi » / « Négocier » d'un contact envoyé. */
function ContactTabs({
  id,
  active,
  labels,
}: {
  id: string;
  active: "followUp" | "negotiation";
  labels: (key: "tab" | "tabFollowUp") => string;
}) {
  const tab = (key: "followUp" | "negotiation", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active === key
          ? "border-primary text-ink"
          : "text-ink-muted hover:text-ink border-transparent"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="border-line flex gap-2 border-b" aria-label={labels("tab")}>
      {tab("followUp", `/app/contacts/${id}`, labels("tabFollowUp"))}
      {tab("negotiation", `/app/contacts/${id}?onglet=${NEGOTIATION_TAB}`, labels("tab"))}
    </nav>
  );
}
