import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { Card, CardHeader } from "@/components/card";
import { CardIssues } from "@/components/card-issues";
import { Icon } from "@/components/icons";
import { BrandMark } from "@/components/logo";
import { PageHeader } from "@/components/page-header";
import { ProfileCardView } from "@/components/profile-card";
import { StatTile } from "@/components/stat-tile";
import { requireUser } from "@/lib/auth/session";
import { getCardState, listCardLinks } from "@/lib/card/repository";
import { isLinkActive } from "@/lib/card/tokens";
import { regenerateCardAction, revokeLinkAction } from "./actions";
import { ApproveCard, CardForm, CreateLink, VaultCheck } from "./card-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("card");
  return { title: t("title") };
}

export default async function CardPage() {
  const user = await requireUser();
  const [t, tp, tm, format, state, links] = await Promise.all([
    getTranslations("card"),
    getTranslations("publicCard"),
    getTranslations("metadata"),
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
  const linkStates = links.map((link) => ({
    link,
    state: link.revokedAt
      ? ("revoked" as const)
      : isLinkActive(link, now)
        ? ("active" as const)
        : ("expired" as const),
  }));
  const activeLinks = linkStates.filter((l) => l.state === "active").length;
  const views = links.reduce((sum, link) => sum + link.viewCount, 0);

  return (
    <>
      <PageHeader band="brand" eyebrow={t("eyebrow")} title={t("title")} lead={t("intro")}>
        <p
          role="status"
          className={`mt-6 flex items-start gap-3 rounded-xl border px-4 py-3 font-medium ${
            state.approvedAt
              ? "border-brand-line bg-brand text-on-brand"
              : "border-warning-line bg-warning-soft text-warning-ink"
          }`}
        >
          <Icon name={state.approvedAt ? "approve" : "clock"} className="mt-0.5 size-5 shrink-0" />
          {status}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatTile
            tone="brand"
            icon={state.issues.length > 0 ? "ban" : "shield"}
            value={format.number(state.issues.length)}
            label={t("stats.issues", { count: state.issues.length })}
          />
          <StatTile
            tone="brand"
            icon="link"
            value={format.number(activeLinks)}
            label={t("stats.activeLinks", { count: activeLinks })}
          />
          <StatTile
            tone="brand"
            icon="eye"
            value={format.number(views)}
            label={t("stats.views", { count: views })}
          />
        </div>
      </PageHeader>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="apercu" className="lg:sticky lg:top-6 lg:col-start-2">
          <h2
            id="apercu"
            className="font-display flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl"
          >
            <Icon name="eye" className="text-brand-ink size-6" />
            {t("preview")}
          </h2>
          {/* Cadre de la page publique `/p/<jeton>` : même carte, même mention. */}
          <div className="border-line-strong bg-canvas mt-3 overflow-hidden rounded-3xl border shadow-sm">
            <div
              aria-hidden="true"
              className="border-line bg-muted flex items-center gap-3 border-b px-4 py-2.5"
            >
              <span className="flex gap-1.5">
                <span className="bg-line-strong size-2.5 rounded-full" />
                <span className="bg-line-strong size-2.5 rounded-full" />
                <span className="bg-line-strong size-2.5 rounded-full" />
              </span>
              <span className="bg-surface text-ink-subtle flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-full px-3 py-1 text-xs">
                <Icon name="lock" className="size-3.5 shrink-0" />
                /p/••••••••
              </span>
            </div>
            <div className="p-3 sm:p-5">
              <div className="mb-4 flex items-center gap-2" aria-hidden="true">
                <BrandMark className="size-7" />
                <span className="font-display text-sm font-bold tracking-tight">
                  {tm("siteName")}
                </span>
              </div>
              <ProfileCardView card={state.card} />
              <p className="text-ink-subtle mt-4 text-xs">{tp("notice")}</p>
            </div>
          </div>
        </section>

        <div className="space-y-6 lg:col-start-1 lg:row-start-1">
          <Card aria-labelledby="modifier-carte">
            <CardHeader id="modifier-carte" icon="edit" title={t("editTitle")} />
            <div className="mt-5">
              {state.issues.length > 0 ? (
                <div className="mb-5">
                  <CardIssues issues={state.issues} />
                </div>
              ) : (
                <p className="text-brand-ink mb-5 flex items-center gap-2 font-medium">
                  <Icon name="shield" className="size-5 shrink-0" />
                  {t("issues.none")}
                </p>
              )}
              {/* Remonté à chaque enregistrement : les valeurs par défaut suivent la carte. */}
              <CardForm key={JSON.stringify(state.card)} card={state.card} />
            </div>
          </Card>

          <VaultCheck card={state.card} />

          <Card aria-labelledby="valider-carte" tone="brand">
            <CardHeader id="valider-carte" icon="approve" title={t("approveTitle")} />
            <div className="mt-5 space-y-5">
              <ApproveCard
                card={state.card}
                disabled={state.issues.length > 0 || Boolean(state.approvedAt)}
              />
              <form action={regenerateCardAction} className="border-brand-line border-t pt-4">
                <button
                  type="submit"
                  className="text-ink-muted hover:text-ink min-h-11 font-medium underline underline-offset-4"
                >
                  {t("form.regenerate")}
                </button>
                <p className="text-ink-muted text-sm">{t("form.regenerateHint")}</p>
              </form>
            </div>
          </Card>
        </div>
      </div>

      <Card aria-labelledby="liens" className="mt-6">
        <CardHeader
          id="liens"
          icon="link"
          title={t("links.title")}
          description={t("links.intro")}
        />
        <div className="mt-5">
          <CreateLink />
        </div>
        {links.length === 0 ? (
          <p className="text-ink-muted border-line-strong mt-5 rounded-xl border border-dashed px-4 py-5 text-center">
            {t("links.empty")}
          </p>
        ) : (
          <ul className="mt-5 grid gap-3 lg:grid-cols-2">
            {linkStates.map(({ link, state: linkState }) => (
              <li
                key={link.id}
                className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
                  linkState === "active" ? "border-brand-line bg-surface" : "border-line bg-subtle"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold break-words">
                      {link.contact
                        ? t("links.forContact", { title: link.contact.offer.title })
                        : t("links.manual")}
                    </p>
                    <Badge tone={linkState === "active" ? "proven" : "neutral"}>
                      {t(`links.${linkState}`)}
                    </Badge>
                  </div>
                  <p className="text-ink-muted mt-1 text-sm">
                    {[
                      t("links.createdAt", { date: format.dateTime(link.createdAt, "short") }),
                      t("links.expiresAt", { date: format.dateTime(link.expiresAt, "short") }),
                    ].join(" · ")}
                  </p>
                  <p className="text-ink-muted mt-0.5 flex items-center gap-1.5 text-sm">
                    <Icon name="eye" className="size-4" />
                    {t("links.views", { count: link.viewCount })}
                  </p>
                </div>
                {linkState === "active" ? (
                  <form action={revokeLinkAction.bind(null, link.id)}>
                    <button
                      type="submit"
                      className="border-danger-line text-danger-ink hover:bg-danger-soft min-h-11 rounded-lg border px-4 py-2 text-sm font-medium"
                    >
                      {t("links.revoke")}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
