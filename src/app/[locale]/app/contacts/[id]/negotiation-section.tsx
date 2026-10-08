import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
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

const sectionClass = "rounded-2xl border border-line bg-surface p-4 sm:p-6";

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
      <section className={sectionClass}>
        <p className="text-ink-muted text-sm">{t("notSent")}</p>
      </section>
    );
  }
  const { mandate, analysis, pending, market } = view;
  const status = view.status;
  const floor = (mandate ?? view.defaults).salaryFloor ?? null;
  const target = (mandate ?? view.defaults).salaryTarget ?? null;
  const money = (n: number) => format.number(n, "salary");

  return (
    <div className="space-y-6">
      <p className="text-ink-muted text-sm">{t("intro")}</p>

      <section className={`${sectionClass} space-y-4`} aria-labelledby="mandat">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mandat" className="text-lg font-semibold">
            {t("mandate.title")}
          </h2>
          {status ? (
            <Badge tone={status === "ACTIVE" ? "proven" : "neutral"}>
              {t(`outcome.status.${status}`)}
            </Badge>
          ) : null}
        </div>
        <p className="text-ink-muted text-sm">{t("mandate.intro")}</p>
        {!view.hasReplies ? <p className="text-ink-muted text-sm">{t("waitReply")}</p> : null}
        {market ? (
          <div className="border-line rounded-xl border px-4 py-3" data-testid="negotiation-market">
            <h3 className="text-sm font-medium">{t("mandate.market.title")}</h3>
            <p className="text-ink-subtle mt-1 mb-3 text-xs">{t("mandate.market.intro")}</p>
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
              <ul className="text-warning-ink mt-3 space-y-1 text-sm" data-testid="mandate-hints">
                {market.hints.map((hint) => (
                  <li key={hint}>
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
      </section>

      <section className={`${sectionClass} space-y-2`} aria-labelledby="analyse">
        <h2 id="analyse" className="text-lg font-semibold">
          {t("analysis.title")}
        </h2>
        {!mandate ? (
          <p className="text-ink-muted text-sm">{t("analysis.noMandate")}</p>
        ) : !analysis || !view.analysedAt ? (
          <p className="text-ink-muted text-sm">{t("analysis.none")}</p>
        ) : (
          <>
            <p className="bg-warning-soft text-warning-ink rounded-lg px-3 py-2 text-xs">
              {t("analysis.estimate", { date: format.dateTime(view.analysedAt, "short") })}
            </p>
            <ul className="text-ink space-y-1 text-sm">
              <li>
                {t(`analysis.salary.${analysis.salary.status}`, {
                  amount:
                    analysis.salary.offered !== null
                      ? formatSalary(view.locale, analysis.salary.offered)
                      : "",
                })}
              </li>
              {analysis.remote ? (
                <li>
                  {t(`analysis.remote.${analysis.remote.status}`, {
                    days: analysis.remote.offered ?? 0,
                  })}
                </li>
              ) : null}
              {analysis.contract ? (
                <li>
                  {t(`analysis.contract.${analysis.contract.status}`, {
                    contract: analysis.contract.offered ? tc(analysis.contract.offered) : "",
                  })}
                </li>
              ) : null}
              {analysis.unchecked > 0 ? (
                <li className="text-ink-muted">
                  {t("analysis.unchecked", { count: analysis.unchecked })}
                </li>
              ) : null}
            </ul>
          </>
        )}
      </section>

      <section className={`${sectionClass} space-y-3`} aria-labelledby="fil">
        <h2 id="fil" className="text-lg font-semibold">
          {t("thread.title")}
        </h2>
        {view.messages.length === 0 ? (
          <p className="text-ink-muted text-sm">{t("thread.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {view.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg border p-3 ${
                  m.direction === "OUT" ? "border-brand-line bg-brand-soft/40" : "border-line"
                }`}
              >
                <p className="text-ink-subtle text-xs">
                  {m.direction === "OUT" ? t("thread.out") : t("thread.in")} ·{" "}
                  {m.direction === "IN"
                    ? t("thread.receivedOn", { date: format.dateTime(m.createdAt, "short") })
                    : t(view.channel === "APPLY_URL" ? "thread.submittedOn" : "thread.sentOn", {
                        date: format.dateTime(m.sentAt ?? m.createdAt, "short"),
                      })}
                </p>
                <p className="text-ink mt-1 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-line">
                  {m.direction === "OUT" ? (m.sentText ?? m.body) : m.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {mandate && status ? (
        <section className={`${sectionClass} space-y-4`} aria-labelledby="message">
          <h2 id="message" className="text-lg font-semibold">
            {t("composer.title")}
          </h2>
          <p className="text-ink-muted text-sm">
            {t("composer.language", { language: LOCALE_NAMES[view.locale] })}
          </p>
          {canGenerate ? (
            <GenerateButton
              key={`${status}:${pending?.id ?? ""}`}
              contactId={view.contactId}
              kind={status === "ACTIVE" ? "counter" : "closing"}
            />
          ) : (
            <div
              role="status"
              className="border-brand-line bg-brand-soft text-brand-ink rounded-xl border px-4 py-4 text-sm"
            >
              <p className="font-medium">{t("upsell.title")}</p>
              <p className="mt-1">{t("upsell.text")}</p>
              <Link
                href="/app/billing"
                className="bg-primary text-on-primary hover:bg-primary-hover mt-3 inline-block rounded-lg px-4 py-2 text-sm font-medium"
              >
                {t("upsell.cta")}
              </Link>
            </div>
          )}
          {pending ? (
            <div className="border-line space-y-4 border-t pt-4">
              <p className="text-ink-muted text-sm">
                {pending.draftSource === "llm" ? t("composer.draftLlm") : t("composer.draftRules")}
              </p>
              {pending.approved && pending.approvedAt ? (
                <p
                  role="status"
                  className="bg-brand-soft text-brand-ink rounded-lg px-3 py-2 text-sm"
                >
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
        </section>
      ) : null}

      {mandate && status ? (
        <section className={`${sectionClass} space-y-3`} aria-labelledby="decision">
          <h2 id="decision" className="text-lg font-semibold">
            {t("outcome.title")}
          </h2>
          <p className="text-ink-muted text-sm">{t("outcome.intro")}</p>
          <OutcomeButtons contactId={view.contactId} status={status} />
        </section>
      ) : null}
    </div>
  );
}
