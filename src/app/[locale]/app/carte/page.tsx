import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { CardIssues } from "@/components/card-issues";
import { PageTitle } from "@/components/empty-state";
import { ProfileCardView } from "@/components/profile-card";
import { requireUser } from "@/lib/auth/session";
import { getCardState, listCardLinks } from "@/lib/card/repository";
import { isLinkActive } from "@/lib/card/tokens";
import { regenerateCardAction, revokeLinkAction } from "./actions";
import { ApproveCard, CardForm, CreateLink, VaultCheck } from "./card-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("card");
  return { title: t("title") };
}

const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";

export default async function CardPage() {
  const user = await requireUser();
  const [t, format, state, links] = await Promise.all([
    getTranslations("card"),
    getFormatter(),
    getCardState(user.id),
    listCardLinks(user.id),
  ]);
  const now = new Date();
  const status = state.approvedAt
    ? t("status.approved", { date: format.dateTime(state.approvedAt, "short") })
    : state.generated
      ? t("status.generated")
      : t("status.notApproved");

  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} intro={t("intro")} />

      <p
        role="status"
        className={`rounded-lg px-4 py-3 text-sm ${
          state.approvedAt
            ? "bg-brand-50 text-brand-800"
            : "border border-stone-200 bg-white text-stone-700"
        }`}
      >
        {status}
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section className={sectionClass}>
            {state.issues.length > 0 ? (
              <div className="mb-5">
                <CardIssues issues={state.issues} />
              </div>
            ) : (
              <p className="text-brand-700 mb-5 text-sm">{t("issues.none")}</p>
            )}
            {/* Remonté à chaque enregistrement : les valeurs par défaut suivent la carte. */}
            <CardForm key={JSON.stringify(state.card)} card={state.card} />
          </section>

          <VaultCheck card={state.card} />

          <section className={`${sectionClass} space-y-4`}>
            <ApproveCard
              card={state.card}
              disabled={state.issues.length > 0 || Boolean(state.approvedAt)}
            />
            <form action={regenerateCardAction}>
              <button
                type="submit"
                className="text-sm text-stone-600 underline underline-offset-4 hover:text-stone-900"
              >
                {t("form.regenerate")}
              </button>
              <p className="mt-1 text-xs text-stone-500">{t("form.regenerateHint")}</p>
            </form>
          </section>
        </div>

        <div className="space-y-6">
          <section aria-labelledby="apercu">
            <h2 id="apercu" className="mb-3 text-lg font-semibold">
              {t("preview")}
            </h2>
            <ProfileCardView card={state.card} />
          </section>

          <section className={sectionClass} aria-labelledby="liens">
            <h2 id="liens" className="text-lg font-semibold">
              {t("links.title")}
            </h2>
            <p className="mt-1 text-sm text-stone-600">{t("links.intro")}</p>
            <div className="mt-4">
              <CreateLink />
            </div>
            {links.length === 0 ? (
              <p className="mt-4 text-sm text-stone-500">{t("links.empty")}</p>
            ) : (
              <ul className="mt-4 divide-y divide-stone-100">
                {links.map((link) => {
                  const state = link.revokedAt
                    ? "revoked"
                    : isLinkActive(link, now)
                      ? "active"
                      : "expired";
                  return (
                    <li
                      key={link.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 text-sm">
                        <p className="font-medium break-words">
                          {link.contact
                            ? t("links.forContact", { title: link.contact.offer.title })
                            : t("links.manual")}
                        </p>
                        <p className="text-xs text-stone-500">
                          {[
                            t("links.createdAt", {
                              date: format.dateTime(link.createdAt, "short"),
                            }),
                            t("links.expiresAt", {
                              date: format.dateTime(link.expiresAt, "short"),
                            }),
                            t("links.views", { count: link.viewCount }),
                            t(`links.${state}`),
                          ].join(" · ")}
                        </p>
                      </div>
                      {state === "active" ? (
                        <form action={revokeLinkAction.bind(null, link.id)}>
                          <button
                            type="submit"
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                          >
                            {t("links.revoke")}
                          </button>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
