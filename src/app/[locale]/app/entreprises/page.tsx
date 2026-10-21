import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { Card, CardHeader } from "@/components/card";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { loadRails } from "@/lib/matching/candidate";
import { ATS_LABELS, ATS_URL_EXAMPLES, SUPPORTED_ATS } from "@/lib/radar/careers";
import {
  listFollowedCompanies,
  MAX_FOLLOWED,
  type FollowedCompanyView,
} from "@/lib/radar/followed";
import { unfollow } from "./actions";
import { FollowForm } from "./follow-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("followedCompanies");
  return { title: t("title") };
}

const STATUS_TONE = {
  ok: "proven",
  waiting: "info",
  failing: "warning",
  paused: "neutral",
} as const satisfies Record<FollowedCompanyView["status"], string>;

/** « Mes entreprises à suivre » : entreprises que le radar surveille pour le candidat. */
export default async function FollowedCompaniesPage() {
  const user = await requireUser();
  const [t, tn, format, rails] = await Promise.all([
    getTranslations("followedCompanies"),
    getTranslations("app.nav.groups"),
    getFormatter(),
    loadRails(db, user.id),
  ]);
  const companies = await listFollowedCompanies(db, user.id, rails);

  return (
    <>
      <PageHeader title={t("title")} lead={t("intro")} eyebrow={tn("agent")} band="brand">
        <ul className="text-ink-muted mt-5 flex flex-wrap gap-2 text-sm">
          <li className="bg-surface/80 ring-brand-line inline-flex items-center gap-2 rounded-full px-3 py-1.5 ring-1">
            <Icon name="star" className="text-brand-ink size-4" />
            {t("count", { count: companies.length, limit: MAX_FOLLOWED })}
          </li>
          <li className="bg-surface/80 ring-brand-line inline-flex items-center gap-2 rounded-full px-3 py-1.5 ring-1">
            <Icon name="lock" className="text-brand-ink size-4" />
            {t("privacyShort")}
          </li>
        </ul>
      </PageHeader>

      <Card aria-labelledby="ajouter" className="mb-6">
        <CardHeader
          id="ajouter"
          icon="plus"
          title={t("add.title")}
          description={t("add.description")}
        />
        <FollowForm full={companies.length >= MAX_FOLLOWED} />
        <div className="text-ink-subtle mt-5 text-sm">
          <p>{t("add.supported")}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {SUPPORTED_ATS.map((ats) => (
              <li
                key={ats}
                className="bg-subtle ring-line rounded-lg px-2.5 py-1 ring-1 ring-inset"
              >
                <span className="text-ink-muted font-medium">{ATS_LABELS[ats]}</span>{" "}
                <code className="text-xs break-all">
                  {ATS_URL_EXAMPLES[ats].replace("{slug}", `<${t("add.slug")}>`)}
                </code>
              </li>
            ))}
          </ul>
          <p className="mt-3">{t("add.unsupportedNote")}</p>
        </div>
      </Card>

      {companies.length === 0 ? (
        <EmptyState icon="building" title={t("list.emptyTitle")} text={t("list.emptyText")} />
      ) : (
        <section
          aria-labelledby="suivies"
          className="border-line bg-surface overflow-hidden rounded-2xl border shadow-sm"
        >
          <h2
            id="suivies"
            className="border-line bg-subtle text-ink-muted flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold sm:px-6"
          >
            <Icon name="building" className="size-4" />
            {t("list.title", { count: companies.length })}
          </h2>
          <ul className="divide-line divide-y">
            {companies.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
              >
                <span
                  aria-hidden="true"
                  className="bg-brand-soft text-brand-ink hidden size-11 shrink-0 items-center justify-center rounded-xl sm:inline-flex"
                >
                  <Icon name="building" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words">{c.name}</p>
                  <p className="text-ink-muted mt-0.5 text-sm break-words">
                    {[
                      c.atsType ? ATS_LABELS[c.atsType] : null,
                      c.sector,
                      t("list.openOffers", { count: c.openOffers }),
                      t("list.followedOn", { date: format.dateTime(c.followedAt, "short") }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone={STATUS_TONE[c.status]} dot>
                      {c.status === "ok" && c.lastRunAt
                        ? t("status.ok", { date: format.dateTime(c.lastRunAt, "short") })
                        : t(`status.${c.status}`)}
                    </Badge>
                    {c.excludedBy ? (
                      <Badge tone="danger" icon="ban">
                        {t(`excluded.${c.excludedBy}`)}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0">
                  <DeleteButton
                    action={unfollow.bind(null, c.id)}
                    confirmMessage={t("unfollowConfirm", { name: c.name })}
                    label={t("unfollow")}
                    small
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-ink-subtle mt-6 flex items-start gap-2 text-sm">
        <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
        {t("privacy")}
      </p>
    </>
  );
}
