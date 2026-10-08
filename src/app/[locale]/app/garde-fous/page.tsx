import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card, CardHeader } from "@/components/card";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { SalaryBenchmarkBlock } from "@/components/salary-benchmark";
import { requireUser } from "@/lib/auth/session";
import { getGuardRails } from "@/lib/career/repository";
import { db } from "@/lib/db";
import { positionAgainst } from "@/lib/radar/benchmarks/compute";
import { BENCHMARK_CONFIG } from "@/lib/radar/benchmarks/config";
import { getCandidateSalaryBenchmark } from "@/lib/radar/salary-benchmarks";
import { GuardRailsForm } from "./guard-rails-form";
import { RailsSummary } from "./rails-summary";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guardRails");
  return { title: t("title") };
}

export default async function GuardRailsPage() {
  const user = await requireUser();
  const [t, tb, initial, market] = await Promise.all([
    getTranslations("guardRails"),
    getTranslations("salaryBenchmark.guardRails"),
    getGuardRails(user.id),
    getCandidateSalaryBenchmark(db, user.id),
  ]);
  const floor = initial.minFixedSalary;
  return (
    <>
      <PageHeader band="brand" eyebrow={t("eyebrow")} title={t("title")} lead={t("intro")}>
        {initial.updatedAt === null ? (
          <p className="border-brand-line bg-surface/80 mt-6 flex items-start gap-3 rounded-xl border px-4 py-3">
            <Icon name="shield" className="text-brand-ink mt-0.5 size-5 shrink-0" />
            {t("emptyHint")}
          </p>
        ) : null}
        <div className="mt-6">
          <RailsSummary rails={initial} tone="brand" />
        </div>
      </PageHeader>

      {market ? (
        <Card aria-labelledby="repere-marche" className="mb-6">
          <CardHeader id="repere-marche" title={tb("title")} description={tb("intro")} />
          <div className="mt-4">
            <SalaryBenchmarkBlock
              benchmark={market.benchmark}
              minSample={BENCHMARK_CONFIG.minSample}
              value={floor}
              position={
                market.benchmark && floor !== null ? positionAgainst(floor, market.benchmark) : null
              }
              positionKey="floorPosition"
            />
          </div>
        </Card>
      ) : null}
      <GuardRailsForm initial={initial} />
    </>
  );
}
