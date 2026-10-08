import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { Card, CardHeader } from "@/components/card";
import { Icon, type IconName } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { LOCALE_NAMES } from "@/i18n/routing";
import type { NegotiationView } from "@/lib/negotiation/repository";
import { formatSalary } from "@/lib/negotiation/draft";
import { DeleteButton } from "@/components/delete-button";
import { SalaryBenchmarkBlock } from "@/components/salary-benchmark";
import { positionAgainst } from "@/lib/radar/benchmarks/compute";
import { BENCHMARK_CONFIG } from "@/lib/radar/benchmarks/config";
import { discardMessageAction } from "../negotiation-actions";
import {
  GenerateButton,
  IssueList,
  MandateForm,
  MessageEditor,
  OutcomeButtons,
  PasteBlock,
} from "./negotiation-panel";

type Check = "ok" | "partial" | "bad" | "unknown";

const CHECK_STYLE: Record<Check, { icon: IconName; className: string }> = {
  ok: { icon: "check", className: "bg-brand text-on-brand" },
  partial: { icon: "check", className: "bg-brand-soft text-brand-ink ring-1 ring-brand-line" },
  bad: { icon: "close", className: "bg-danger text-on-danger" },
  unknown: { icon: "help", className: "bg-muted text-ink-muted" },
};

/** Ligne d'analyse cochée (conforme), barrée (non conforme) ou « ? » (non précisé). */
function CheckLine({ check, children }: { check: Check; children: React.ReactNode }) {
  const style = CHECK_STYLE[check];
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full ${style.className}`}
      >
        <Icon name={style.icon} className="size-3.5" strokeWidth={2.5} />
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

const SALARY_CHECK: Record<string, Check> = {
  aboveTarget: "ok",
  aboveFloor: "partial",
  belowFloor: "bad",
  unknown: "unknown",
};
const TERM_CHECK: Record<string, Check> = { met: "ok", notMet: "bad", unknown: "unknown" };

/**
 * Onglet « Négocier » d'un contact : mandat, analyse (estimation) de la
 * dernière proposition, fil, prochain message (Premium) et décision.
 */
export async function NegotiationSection({
  view,
  canGenerate,
}: {
  view: NegotiationView;
  canGenerate: boolean;
}) {
  const [t, tc, format] = await Promise.all([
    getTranslations("negotiation"),
    getTranslations("codes.contractType"),
    getFormatter(),
  ]);
  if (!view.sent) {
    return (
      <Card>
        <p className="text-ink-muted flex items-center gap-3">
          <Icon name="clock" className="text-ink-subtle size-5 shrink-0" />
          {t("notSent")}
        </p>
      </Card>
    );
  }
  const { mandate, analysis, pending, market } = view;
  const status = view.status;
  const floor = (mandate ?? view.defaults).salaryFloor ?? null;
  const target = (mandate ?? view.defaults).salaryTarget ?? null;
  const money = (n: number) => format.number(n, "salary");

  return (
    <div className="space-y-6">
      <p className="border-line bg-surface text-ink-muted flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-xs">
        <span
          aria-hidden="true"
          className="bg-night text-signal inline-flex size-8 shrink-0 items-center justify-center rounded-full"
        >
          <Icon name="spark" className="size-4" />
        </span>
        <span className="text-pretty">{t("intro")}</span>
      </p>

      <Card aria-labelledby="mandat" className="space-y-5">
        <CardHeader
          id="mandat"
          title={t("mandate.title")}
          description={t("mandate.intro")}
          actions={
            status ? (
              <Badge tone={status === "ACTIVE" ? "proven" : "neutral"}>
                {t(`outcome.status.${status}`)}
              </Badge>
            ) : null
          }
        />
        {!view.hasReplies ? (
          <p className="text-ink-muted flex items-center gap-2">
            <Icon name="clock" className="text-ink-subtle size-5 shrink-0" />
            {t("waitReply")}
          </p>
        ) : null}
        {market ? (
          <div
            className="border-line bg-subtle rounded-xl border px-4 py-4 sm:px-5"
            data-testid="negotiation-market"
          >
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Icon name="coins" className="text-brand-ink size-5" />
              {t("mandate.market.title")}
            </h3>
            <p className="text-ink-subtle mt-1 mb-3 text-sm">{t("mandate.market.intro")}</p>
            <SalaryBenchmarkBlock
              benchmark={market.benchmark}
              minSample={BENCHMARK_CONFIG.minSample}
              value={floor}
              position={
                market.benchmark && floor !== null ? positionAgainst(floor, market.benchmark) : null
              }
              positionKey="floorPosition"
            />
            {market.hints.length > 0 ? (
              <ul className="text-warning-ink mt-3 space-y-1.5 text-sm" data-testid="mandate-hints">
                {market.hints.map((hint) => (
                  <li key={hint} className="flex items-start gap-2">
                    <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
                    {t(`mandate.market.hints.${hint}`, {
                      amount: money(hint === "floorAboveOffer" ? (floor ?? 0) : (target ?? 0)),
                      p25: market.benchmark ? money(market.benchmark.p25) : "",
                      p75: market.benchmark ? money(market.benchmark.p75) : "",
                      max: market.offerMaxAnnual !== null ? money(market.offerMaxAnnual) : "",
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <MandateForm contactId={view.contactId} mandate={mandate} defaults={view.defaults} />
      </Card>

      <Card aria-labelledby="analyse" className="space-y-4">
        <CardHeader id="analyse" title={t("analysis.title")} />
        {!mandate ? (
          <p className="text-ink-muted">{t("analysis.noMandate")}</p>
        ) : !analysis || !view.analysedAt ? (
          <p className="text-ink-muted">{t("analysis.none")}</p>
        ) : (
          <>
            <p className="bg-warning-soft text-warning-ink flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm">
              <Icon name="info" className="mt-0.5 size-4 shrink-0" />
              {t("analysis.estimate", { date: format.dateTime(view.analysedAt, "short") })}
            </p>
            <ul className="text-ink space-y-3">
              <CheckLine check={SALARY_CHECK[analysis.salary.status] ?? "unknown"}>
                {t(`analysis.salary.${analysis.salary.status}`, {
                  amount:
                    analysis.salary.offered !== null
                      ? formatSalary(view.locale, analysis.salary.offered)
                      : "",
                })}
              </CheckLine>
              {analysis.remote ? (
                <CheckLine check={TERM_CHECK[analysis.remote.status] ?? "unknown"}>
                  {t(`analysis.remote.${analysis.remote.status}`, {
                    days: analysis.remote.offered ?? 0,
                  })}
                </CheckLine>
              ) : null}
              {analysis.contract ? (
                <CheckLine check={TERM_CHECK[analysis.contract.status] ?? "unknown"}>
                  {t(`analysis.contract.${analysis.contract.status}`, {
                    contract: analysis.contract.offered ? tc(analysis.contract.offered) : "",
                  })}
                </CheckLine>
              ) : null}
              {analysis.unchecked > 0 ? (
                <CheckLine check="unknown">
                  <span className="text-ink-muted">
                    {t("analysis.unchecked", { count: analysis.unchecked })}
                  </span>
                </CheckLine>
              ) : null}
            </ul>
          </>
        )}
      </Card>

      <Card aria-labelledby="fil" className="space-y-4">
        <CardHeader id="fil" title={t("thread.title")} />
        {view.messages.length === 0 ? (
          <p className="text-ink-muted">{t("thread.empty")}</p>
        ) : (
          <ul className="space-y-4">
            {view.messages.map((m) => {
              const out = m.direction === "OUT";
              return (
                <li
                  key={m.id}
                  className={`flex items-start gap-3 ${out ? "flex-row-reverse" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${
                      out ? "bg-night text-signal" : "bg-muted text-ink-muted"
                    }`}
                  >
                    <Icon name={out ? "spark" : "building"} className="size-4.5" />
                  </span>
                  <div
                    className={`max-w-[85%] min-w-0 rounded-2xl border px-4 py-3 ${
                      out
                        ? "border-brand-line bg-brand-soft rounded-tr-md"
                        : "border-line bg-subtle rounded-tl-md"
                    }`}
                  >
                    <p className="text-ink-muted text-sm">
                      <span className="text-ink font-semibold">
                        {out ? t("thread.out") : t("thread.in")}
                      </span>{" "}
                      ·{" "}
                      {m.direction === "IN"
                        ? t("thread.receivedOn", { date: format.dateTime(m.createdAt, "short") })
                        : t(view.channel === "APPLY_URL" ? "thread.submittedOn" : "thread.sentOn", {
                            date: format.dateTime(m.sentAt ?? m.createdAt, "short"),
                          })}
                    </p>
                    <p className="text-ink mt-1 [overflow-wrap:anywhere] break-words whitespace-pre-line">
                      {out ? (m.sentText ?? m.body) : m.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {mandate && status ? (
        <Card aria-labelledby="message" className="space-y-4">
          <CardHeader
            id="message"
            title={t("composer.title")}
            description={t("composer.language", { language: LOCALE_NAMES[view.locale] })}
          />
          {canGenerate ? (
            <GenerateButton
              key={`${status}:${pending?.id ?? ""}`}
              contactId={view.contactId}
              kind={status === "ACTIVE" ? "counter" : "closing"}
            />
          ) : (
            <div
              role="status"
              data-tone="night"
              className="band-night on-night border-night-line text-on-night flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center"
            >
              <span
                aria-hidden="true"
                className="bg-night-raised text-signal ring-night-line inline-flex size-11 shrink-0 items-center justify-center rounded-xl ring-1"
              >
                <Icon name="star" className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-bold">{t("upsell.title")}</p>
                <p className="text-on-night-muted mt-1">{t("upsell.text")}</p>
              </div>
              <Link href="/app/billing" className={`${buttonClass("signal")} shrink-0`}>
                {t("upsell.cta")}
                <Icon name="arrow" className="size-4" />
              </Link>
            </div>
          )}
          {pending ? (
            <div className="border-line space-y-4 border-t pt-5">
              <p className="text-ink-muted">
                {pending.draftSource === "llm" ? t("composer.draftLlm") : t("composer.draftRules")}
              </p>
              {pending.approved && pending.approvedAt ? (
                <p
                  role="status"
                  className="bg-brand-soft text-brand-ink flex items-start gap-2 rounded-xl px-3 py-2.5"
                >
                  <Icon name="approve" className="mt-0.5 size-5 shrink-0" />
                  {t("composer.approvedOn", {
                    date: format.dateTime(pending.approvedAt, "short"),
                  })}
                </p>
              ) : null}
              <IssueList issues={view.pendingIssues} />
              <MessageEditor
                key={`${pending.id}:${pending.status}:${pending.body}`}
                contactId={view.contactId}
                id={pending.id}
                body={pending.body}
                approved={pending.approved}
                channel={view.channel}
              />
              {view.channel === "APPLY_URL" && pending.approved && pending.sentText ? (
                <PasteBlock contactId={view.contactId} id={pending.id} text={pending.sentText} />
              ) : null}
              {pending.status !== "SENDING" ? (
                <DeleteButton
                  action={discardMessageAction.bind(null, view.contactId, pending.id)}
                  confirmMessage={t("composer.discardConfirm")}
                  label={t("composer.discard")}
                  small
                />
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      {mandate && status ? (
        <Card aria-labelledby="decision" className="space-y-4">
          <CardHeader id="decision" title={t("outcome.title")} description={t("outcome.intro")} />
          <OutcomeButtons contactId={view.contactId} status={status} />
        </Card>
      ) : null}
    </div>
  );
}
