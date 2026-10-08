import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardHeader } from "@/components/card";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { ProfileCardView } from "@/components/profile-card";
import { RevealedIdentityView } from "@/components/revealed-identity";
import { getThread } from "@/lib/employer/inbox";
import { requireEmployer } from "@/lib/employer/session";
import { BackLink } from "../../parts";
import { ThreadStatusBadge } from "../status-badge";
import { CloseThreadButton, ThreadReplyForm } from "./thread-forms";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.inbox");
  return { title: t("title"), referrer: "no-referrer" };
}

/**
 * Un fil de la messagerie : carte anonyme (mêmes règles que le lien public),
 * message de l'agent du candidat, réponses, et champs révélés par le
 * candidat s'il a levé son anonymat auprès de cette organisation. Fil d'une
 * autre organisation, non-membre ou identifiant inventé : 404.
 */
export default async function EmployerThreadPage({ params }: Props) {
  const { org } = await requireEmployer();
  const { id } = await params;
  const thread = await getThread(org.id, id, { open: true });
  if (!thread) notFound();
  const [t, format] = await Promise.all([getTranslations("employer.inbox"), getFormatter()]);
  const closed = thread.status === "CLOSED";

  return (
    <div className="max-w-4xl">
      <BackLink href="/entreprise/messages">{t("back")}</BackLink>

      <PageHeader
        title={t("threadTitle", { title: thread.offerTitle })}
        lead={
          thread.sentAt
            ? t("receivedOn", { date: format.dateTime(thread.sentAt, "short") })
            : undefined
        }
        actions={<ThreadStatusBadge status={thread.status} />}
      />

      <div className="space-y-6">
        {thread.revealed ? (
          <Card tone="brand" aria-labelledby="identite">
            <CardHeader
              id="identite"
              title={t("revealedTitle")}
              description={t("revealedDisclosure")}
            />
            <div className="mt-5">
              <RevealedIdentityView
                identity={thread.revealed.identity}
                cvHref={`/api/entreprise/messages/${encodeURIComponent(thread.id)}/cv`}
              />
            </div>
            <p className="text-ink-muted mt-3 text-sm">
              {t("revealedExpires", { date: format.dateTime(thread.revealed.expiresAt, "short") })}
            </p>
          </Card>
        ) : null}

        <section aria-labelledby="carte">
          <h2 id="carte" className="font-display mb-4 text-xl font-bold tracking-tight sm:text-2xl">
            {t("cardTitle")}
          </h2>
          {thread.card ? (
            <ProfileCardView card={thread.card} />
          ) : (
            <p className="border-line-strong bg-surface text-ink-muted rounded-2xl border border-dashed px-5 py-4">
              {t("cardGone")}
            </p>
          )}
        </section>

        <Card aria-labelledby="message">
          <CardHeader id="message" title={t("messageTitle")} />
          <p className="bg-subtle text-ink-muted mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm">
            <Icon name="spark" className="text-brand-ink mt-0.5 size-4 shrink-0" />
            {t("aiDisclosure")}
          </p>
          <p className="mt-5 text-lg font-semibold [overflow-wrap:anywhere] break-words">
            {thread.message.subject}
          </p>
          <p className="text-ink mt-2 max-w-[70ch] [overflow-wrap:anywhere] break-words whitespace-pre-line">
            {thread.message.body}
          </p>
        </Card>

        <Card aria-labelledby="reponses">
          <CardHeader id="reponses" title={t("repliesTitle")} />
          {thread.replies.length === 0 ? (
            <p className="text-ink-muted mt-3">{t("noReply")}</p>
          ) : (
            <ol className="mt-5 space-y-4">
              {thread.replies.map((r) => {
                const candidate = r.from === "candidate";
                return (
                  <li key={r.id} className={`flex ${candidate ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[88%] rounded-2xl px-4 py-3 sm:max-w-[80%] ${
                        candidate
                          ? "bg-muted text-ink rounded-tl-sm"
                          : "bg-primary text-on-primary rounded-tr-sm"
                      }`}
                    >
                      <p
                        className={`text-sm font-medium ${candidate ? "text-ink-muted" : "text-on-primary/80"}`}
                      >
                        {t(candidate ? "candidateOn" : r.closing ? "closedOn" : "repliedOn", {
                          date: format.dateTime(r.createdAt, "short"),
                        })}
                      </p>
                      <p className="mt-1 [overflow-wrap:anywhere] break-words whitespace-pre-line">
                        {r.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {closed ? (
            <p className="bg-subtle text-ink-muted mt-6 rounded-xl px-4 py-3">
              {t("closedNotice")}
            </p>
          ) : (
            <div className="border-line mt-6 space-y-6 border-t pt-6">
              <ThreadReplyForm id={thread.id} />
              <div className="border-line border-t pt-5">
                <p className="text-ink-muted mb-3">{t("closeHint")}</p>
                <CloseThreadButton id={thread.id} />
              </div>
            </div>
          )}
        </Card>

        <p className="text-ink-muted flex items-start gap-2 text-sm">
          <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
          {t("threadPrivacy")}
        </p>
      </div>
    </div>
  );
}
