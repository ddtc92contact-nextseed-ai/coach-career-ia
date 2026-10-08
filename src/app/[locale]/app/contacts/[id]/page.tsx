import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { Card, CardHeader } from "@/components/card";
import { DeleteButton } from "@/components/delete-button";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
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
import { ContactStatusBadge } from "../contact-status";
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

const backClass =
  "text-ink-muted hover:text-ink mb-4 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline";
const linkClass =
  "text-brand-ink inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline";

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
      <div className="max-w-4xl">
        <Link href="/app/contacts" className={backClass}>
          {t("back")}
        </Link>
        <PageHeader
          title={contact.offer.title}
          lead={contact.offer.companyName ?? tc("companyUnknown")}
          eyebrow={tn("title")}
        />
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

  const replied = contact.replies.length > 0;
  const unread = contact.replies.filter((r) => !r.readAt).length;

  return (
    <div className="max-w-4xl">
      <Link href="/app/contacts" className={backClass}>
        {t("back")}
      </Link>

      <PageHeader
        title={contact.offer.title}
        lead={contact.offer.companyName ?? tc("companyUnknown")}
        eyebrow={tc(`channel.${contact.channel}`)}
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ContactStatusBadge
            contact={{ status: contact.status, replies: contact.replies.length, unread }}
          />
          {sent ? (
            <Badge
              tone={handover.active ? "night" : "neutral"}
              icon={handover.active ? "unlock" : "lock"}
            >
              {handover.active ? th("status.revealed") : th("status.anonymous")}
            </Badge>
          ) : null}
        </div>
        {contact.channel === "EMAIL" || contact.channel === "PORTAL" ? (
          <p className="text-ink-muted mt-3 flex items-start gap-2 text-sm">
            <Icon
              name={contact.channel === "PORTAL" ? "building" : "mail"}
              className="mt-0.5 size-4 shrink-0"
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {contact.channel === "EMAIL"
                ? contact.offer.recipient
                  ? t("recipient", { email: contact.offer.recipient })
                  : t("recipientHidden")
                : t("recipientPortal")}
            </span>
          </p>
        ) : null}
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {contact.channel === "APPLY_URL" && contact.offer.applyUrl ? (
            <a
              href={contact.offer.applyUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={linkClass}
            >
              {t("applyPage")}
              <Icon name="external" className="size-4" />
            </a>
          ) : null}
          <a
            href={contact.offer.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={linkClass}
          >
            {t("original")}
            <Icon name="external" className="size-4" />
          </a>
          {contact.offer.matchId ? (
            <Link href={`/app/opportunites/${contact.offer.matchId}`} className={linkClass}>
              {t("opportunity")}
              <Icon name="arrow" className="size-4" />
            </Link>
          ) : null}
        </p>
        {!contact.offer.open ? (
          <p className="text-warning-ink mt-3 flex items-center gap-2 text-sm font-medium">
            <Icon name="alert" className="size-4" />
            {t("offerClosed")}
          </p>
        ) : null}
      </PageHeader>

      <ContactSteps status={contact.status} replied={replied} />

      {contact.status === "SENT" ? (
        <ContactTabs id={contact.id} active="followUp" labels={tn} />
      ) : null}

      <div className="space-y-6">
        {sent ? (
          <Card aria-labelledby="envoye">
            <CardHeader
              id="envoye"
              title={t("sentText")}
              description={
                contact.sentAt
                  ? tc(contact.channel === "APPLY_URL" ? "submittedOn" : "sentOn", {
                      date: format.dateTime(contact.sentAt, "short"),
                    })
                  : undefined
              }
            />
            <div className="border-line mt-4 overflow-hidden rounded-xl border">
              <p className="border-line bg-subtle border-b px-4 py-3 font-semibold [overflow-wrap:anywhere] break-words">
                {contact.subject}
              </p>
              <p className="text-ink px-4 py-3 [overflow-wrap:anywhere] break-words whitespace-pre-line">
                {contact.sentText ?? contact.body}
              </p>
            </div>
          </Card>
        ) : (
          <Card aria-labelledby="brouillon" className="space-y-5">
            <CardHeader
              id="brouillon"
              title={t("draftTitle")}
              description={
                <>
                  {contact.draftSource === "llm" ? t("draftLlm") : t("draftRules")}{" "}
                  {t("language", { language: LOCALE_NAMES[contact.locale] })}
                </>
              }
            />
            {contact.approved && contact.approvedAt ? (
              <p
                role="status"
                className="bg-brand-soft text-brand-ink flex items-start gap-2 rounded-xl px-3 py-2.5"
              >
                <Icon name="approve" className="mt-0.5 size-5 shrink-0" />
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
              <div className="band-brand border-brand-line space-y-3 rounded-xl border p-4 sm:p-5">
                <h3 className="text-lg font-semibold">{t("paste")}</h3>
                <p className="text-ink-muted">{t("pasteHint")}</p>
                <CopyText text={contact.sentText} />
                <form action={markSubmittedAction.bind(null, contact.id)}>
                  <button
                    type="submit"
                    className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}
                  >
                    <Icon name="check" className="size-5" />
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
          </Card>
        )}

        {contact.cardLink && (sent || contact.channel === "APPLY_URL") ? (
          <p className="text-ink-muted flex items-start gap-2 px-1 text-sm">
            <Icon name="card" className="text-ink-subtle mt-0.5 size-4 shrink-0" />
            {linkActive
              ? t(contact.channel === "PORTAL" ? "portalCard" : "link", {
                  date: format.dateTime(contact.cardLink.expiresAt, "short"),
                  views: contact.cardLink.viewCount,
                })
              : t(contact.channel === "PORTAL" ? "portalCardRevoked" : "linkRevoked")}
          </p>
        ) : null}

        {sent ? (
          <Card aria-labelledby="reponses">
            <CardHeader id="reponses" title={t("replies")} />
            {contact.replies.length === 0 ? (
              <p className="text-ink-muted mt-4 flex items-center gap-3">
                <span className="bg-muted text-ink-subtle inline-flex size-10 shrink-0 items-center justify-center rounded-full">
                  <Icon name="clock" className="size-5" />
                </span>
                {t("noReply")}
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {contact.replies.map((r) => (
                  <li key={r.id} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="bg-muted text-ink-muted inline-flex size-9 shrink-0 items-center justify-center rounded-full"
                    >
                      <Icon name="building" className="size-4.5" />
                    </span>
                    <div className="border-line bg-subtle min-w-0 flex-1 rounded-2xl rounded-tl-md border px-4 py-3">
                      <p className="text-ink-subtle text-sm">
                        {t(r.closing ? "closedOn" : "receivedOn", {
                          date: format.dateTime(r.createdAt, "short"),
                        })}
                      </p>
                      <p className="text-ink mt-1 [overflow-wrap:anywhere] break-words whitespace-pre-line">
                        {r.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {sent ? (
          <Card aria-labelledby="anonymat" className="space-y-4">
            <CardHeader
              id="anonymat"
              title={
                <span className="flex items-center gap-2">
                  <Icon
                    name={handover.active ? "unlock" : "lock"}
                    className="text-brand-ink size-5 shrink-0"
                  />
                  {th("title")}
                </span>
              }
            />
            {handover.active ? (
              <div className="space-y-3">
                <p className="bg-brand-soft text-brand-ink rounded-xl px-3 py-2.5">
                  {th("active", {
                    date: format.dateTime(handover.active.createdAt, "short"),
                    fields: fieldList(handover.active.fields),
                  })}
                </p>
                <p className="text-ink-muted">
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
              <p className="text-ink-muted">{th("closed")}</p>
            ) : contact.replies.length === 0 ? (
              <p className="text-ink-muted">{th("waitReply")}</p>
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
                <h3 className="text-lg font-semibold">{th("logTitle")}</h3>
                <ul className="text-ink-muted mt-2 space-y-1.5 text-sm">
                  {handover.events.map((e) => (
                    <li key={e.id} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="bg-line-strong mt-2 size-1.5 shrink-0 rounded-full"
                      />
                      {th(`log.${e.type}`, {
                        date: format.dateTime(e.createdAt, "short"),
                        fields: fieldList(e.fields),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

const STEPS = ["drafted", "approved", "sent", "replied"] as const;

/**
 * Où en est la prise de contact : rédigée par l'agent → approuvée par vous →
 * envoyée → réponse. L'étape en cours est annoncée (`aria-current="step"`).
 */
async function ContactSteps({
  status,
  replied,
}: {
  status: "DRAFT" | "APPROVED" | "SENDING" | "SENT";
  replied: boolean;
}) {
  const t = await getTranslations("contacts.steps");
  // Index de l'étape en cours (les précédentes sont faites).
  const current =
    status === "DRAFT" ? 1 : status === "APPROVED" || status === "SENDING" ? 2 : replied ? 4 : 3;
  return (
    <ol
      aria-label={t("label")}
      className="border-line bg-surface mb-6 grid grid-cols-2 gap-x-3 gap-y-3 rounded-2xl border p-4 shadow-xs sm:grid-cols-4 sm:p-5"
    >
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className="flex min-w-0 items-center gap-2.5"
          >
            <span
              aria-hidden="true"
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                done
                  ? "bg-brand text-on-brand"
                  : active
                    ? "bg-warning-soft text-warning-ink ring-warning-line ring-2"
                    : "bg-muted text-ink-subtle"
              }`}
            >
              {done ? <Icon name="check" className="size-4" strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span
                className={`block text-sm leading-tight hyphens-auto ${
                  done || active ? "text-ink font-semibold" : "text-ink-subtle"
                }`}
              >
                {t(step)}
              </span>
              <span className="sr-only">
                {" "}
                · {done ? t("done") : active ? t("current") : t("upcoming")}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
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
      className={`inline-flex min-h-10 flex-1 items-center justify-center rounded-lg px-4 py-2 font-medium motion-safe:transition-colors sm:flex-none ${
        active === key
          ? "bg-primary text-on-primary shadow-sm"
          : "text-ink-muted hover:bg-muted hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav
      className="border-line bg-surface mb-6 flex gap-1 rounded-xl border p-1 shadow-xs sm:inline-flex"
      aria-label={labels("tab")}
    >
      {tab("followUp", `/app/contacts/${id}`, labels("tabFollowUp"))}
      {tab("negotiation", `/app/contacts/${id}?onglet=${NEGOTIATION_TAB}`, labels("tab"))}
    </nav>
  );
}
