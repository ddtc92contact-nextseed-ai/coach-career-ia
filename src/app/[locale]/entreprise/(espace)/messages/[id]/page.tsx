import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ProfileCardView } from "@/components/profile-card";
import { RevealedIdentityView } from "@/components/revealed-identity";
import { Link } from "@/i18n/navigation";
import { getThread } from "@/lib/employer/inbox";
import { requireEmployer } from "@/lib/employer/session";
import { ThreadStatusBadge } from "../status-badge";
import { CloseThreadButton, ThreadReplyForm } from "./thread-forms";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.inbox");
  return { title: t("title"), referrer: "no-referrer" };
}

const sectionClass = "rounded-2xl border border-line bg-surface p-4 sm:p-6";

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
    <div className="max-w-3xl space-y-6">
      <Link href="/entreprise/messages" className="text-ink-muted text-sm hover:underline">
        {t("back")}
      </Link>

      <header>
        <ThreadStatusBadge status={thread.status} />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight break-words">
          {t("threadTitle", { title: thread.offerTitle })}
        </h1>
        {thread.sentAt ? (
          <p className="text-ink-muted mt-1 text-sm">
            {t("receivedOn", { date: format.dateTime(thread.sentAt, "short") })}
          </p>
        ) : null}
      </header>

      {thread.revealed ? (
        <section aria-labelledby="identite" className="space-y-3">
          <h2 id="identite" className="text-lg font-semibold">
            {t("revealedTitle")}
          </h2>
          <p className="bg-brand-soft text-brand-ink rounded-lg px-3 py-2 text-sm">
            {t("revealedDisclosure")}
          </p>
          <RevealedIdentityView
            identity={thread.revealed.identity}
            cvHref={`/api/entreprise/messages/${encodeURIComponent(thread.id)}/cv`}
          />
          <p className="text-ink-subtle text-xs">
            {t("revealedExpires", { date: format.dateTime(thread.revealed.expiresAt, "short") })}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="carte">
        <h2 id="carte" className="mb-3 text-lg font-semibold">
          {t("cardTitle")}
        </h2>
        {thread.card ? (
          <ProfileCardView card={thread.card} />
        ) : (
          <p className="border-line-strong bg-surface text-ink-muted rounded-lg border border-dashed px-4 py-3 text-sm">
            {t("cardGone")}
          </p>
        )}
      </section>

      <section className={sectionClass} aria-labelledby="message">
        <h2 id="message" className="text-lg font-semibold">
          {t("messageTitle")}
        </h2>
        <p className="bg-subtle text-ink-muted mt-2 rounded-lg px-3 py-2 text-sm">
          {t("aiDisclosure")}
        </p>
        <p className="mt-3 text-sm font-medium [overflow-wrap:anywhere] break-words">
          {thread.message.subject}
        </p>
        <p className="text-ink mt-2 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-line">
          {thread.message.body}
        </p>
      </section>

      <section className={`${sectionClass} space-y-4`} aria-labelledby="reponses">
        <h2 id="reponses" className="text-lg font-semibold">
          {t("repliesTitle")}
        </h2>
        {thread.replies.length === 0 ? (
          <p className="text-ink-muted text-sm">{t("noReply")}</p>
        ) : (
          <ul className="space-y-3">
            {thread.replies.map((r) => (
              <li
                key={r.id}
                className={`rounded-lg border p-3 ${
                  r.from === "candidate" ? "border-line bg-subtle" : "border-line"
                }`}
              >
                <p className="text-ink-subtle text-xs">
                  {t(
                    r.from === "candidate" ? "candidateOn" : r.closing ? "closedOn" : "repliedOn",
                    { date: format.dateTime(r.createdAt, "short") },
                  )}
                </p>
                <p className="text-ink mt-1 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-line">
                  {r.body}
                </p>
              </li>
            ))}
          </ul>
        )}
        {closed ? (
          <p className="text-ink-muted text-sm">{t("closedNotice")}</p>
        ) : (
          <div className="border-line space-y-4 border-t pt-4">
            <ThreadReplyForm id={thread.id} />
            <div className="border-line border-t pt-4">
              <p className="text-ink-muted mb-2 text-sm">{t("closeHint")}</p>
              <CloseThreadButton id={thread.id} />
            </div>
          </div>
        )}
      </section>

      <p className="text-ink-subtle text-xs">{t("threadPrivacy")}</p>
    </div>
  );
}
