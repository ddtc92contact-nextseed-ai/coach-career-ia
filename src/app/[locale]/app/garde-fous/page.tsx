import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { SalaryBenchmarkBlock } from "@/components/salary-benchmark";
import { requireUser } from "@/lib/auth/session";
import { getGuardRails } from "@/lib/career/repository";
import { db } from "@/lib/db";
import { positionAgainst } from "@/lib/radar/benchmarks/compute";
import { BENCHMARK_CONFIG } from "@/lib/radar/benchmarks/config";
import { getCandidateSalaryBenchmark } from "@/lib/radar/salary-benchmarks";
import { GuardRailsForm } from "./guard-rails-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guardRails");
  return { title: t("title") };
}

export default async function GuardRailsPage() {
  const user = await requireUser();
  const [t, tb, format, initial, market] = await Promise.all([
    getTranslations("guardRails"),
    getTranslations("salaryBenchmark.guardRails"),
    getFormatter(),
    getGuardRails(user.id),
    getCandidateSalaryBenchmark(db, user.id),
  ]);
  const floor = initial.minFixedSalary;
  return (
    <div className="max-w-4xl">
      <PageTitle title={t("title")} intro={t("intro")} />
      {initial.updatedAt === null ? (
        <p className="border-line bg-surface text-ink-muted mb-6 rounded-lg border px-4 py-3 text-sm">
          {t("emptyHint")}
        </p>
      ) : null}
      {initial.minFixedSalary !== null ? (
        <div className="border-line bg-surface mb-6 rounded-lg border px-4 py-3 text-sm">
          <p className="font-medium">{t("summary.title")}</p>
          <p className="text-ink-muted mt-1">
            {t("summary.minFixed", { amount: format.number(initial.minFixedSalary, "salary") })}
          </p>
          {initial.targetTotalPackage !== null ? (
            <p className="text-ink-muted">
              {t("summary.targetPackage", {
                amount: format.number(initial.targetTotalPackage, "salary"),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {market ? (
        <section
          aria-labelledby="repere-marche"
          className="border-line bg-surface mb-6 rounded-lg border px-4 py-3"
        >
          <h2 id="repere-marche" className="text-sm font-medium">
            {tb("title")}
          </h2>
          <p className="text-ink-subtle mt-1 mb-3 text-xs">{tb("intro")}</p>
          <SalaryBenchmarkBlock
            benchmark={market.benchmark}
            minSample={BENCHMARK_CONFIG.minSample}
            value={floor}
            position={
              market.benchmark && floor !== null ? positionAgainst(floor, market.benchmark) : null
            }
            positionKey="floorPosition"
          />
        </section>
      ) : null}
      <GuardRailsForm initial={initial} />
    </div>
  );
}
