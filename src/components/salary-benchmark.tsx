import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { SalaryBenchmark, SalaryPosition } from "@/lib/radar/salary-benchmarks";
import { REMOTE_AREA, type BenchmarkSeniority } from "@/lib/radar/benchmarks/compute";

/** Libellé du périmètre réellement utilisé (« data / IA · Senior · Île-de-France »). */
async function scopeLabel(benchmark: SalaryBenchmark): Promise<string> {
  const [t, tf, ts, locale] = await Promise.all([
    getTranslations("salaryBenchmark"),
    getTranslations("companySignals.families"),
    getTranslations("codes.seniority"),
    getLocale(),
  ]);
  const country = new Intl.DisplayNames([locale], { type: "region" }).of(benchmark.country);
  const place =
    benchmark.area === REMOTE_AREA
      ? t("remote", { country: country ?? benchmark.country })
      : (benchmark.area ?? country ?? benchmark.country);
  const seniority =
    benchmark.seniority === "ALL"
      ? t("allSeniorities")
      : ts(benchmark.seniority as BenchmarkSeniority);
  const label = [tf(benchmark.family), seniority, place].join(" · ");
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
}

const POSITION_TONE: Record<SalaryPosition, string> = {
  BELOW: "text-amber-800",
  WITHIN: "text-stone-800",
  ABOVE: "text-emerald-800",
};

/** Barre p25–p75 avec, si connue, la position d'une valeur (offre ou plancher). */
function RangeBar({ benchmark, value }: { benchmark: SalaryBenchmark; value: number | null }) {
  const low = Math.min(benchmark.p25, value ?? benchmark.p25) * 0.85;
  const high = Math.max(benchmark.p75, value ?? benchmark.p75) * 1.15;
  const at = (v: number) => `${((v - low) / (high - low)) * 100}%`;
  return (
    <div aria-hidden="true" className="relative mt-4 h-3 rounded-full bg-stone-100">
      <div
        className="bg-brand-100 absolute inset-y-0 rounded-full"
        style={{ left: at(benchmark.p25), right: `calc(100% - ${at(benchmark.p75)})` }}
      />
      <div
        className="bg-brand-600 absolute inset-y-0 w-0.5"
        style={{ left: at(benchmark.median) }}
      />
      {value !== null ? (
        <div
          className="absolute -top-1 h-5 w-1.5 -translate-x-1/2 rounded-full bg-stone-900"
          style={{ left: at(value) }}
        />
      ) : null}
    </div>
  );
}

/**
 * Repère de salaire du marché : p25 / médiane / p75, taille d'échantillon et
 * périmètre, toujours présenté comme une estimation tirée d'offres publiées.
 * Sans repère : état « pas assez de données », jamais de chiffre inventé.
 */
export async function SalaryBenchmarkBlock({
  benchmark,
  minSample,
  value,
  position,
  positionKey,
}: {
  benchmark: SalaryBenchmark | null;
  minSample: number;
  /** Valeur annuelle à situer (fourchette de l'offre, plancher du candidat). */
  value: number | null;
  position: SalaryPosition | null;
  /** Famille de messages des phrases de position (`offerPosition` ou `floorPosition`). */
  positionKey: "offerPosition" | "floorPosition";
}) {
  const [t, format] = await Promise.all([getTranslations("salaryBenchmark"), getFormatter()]);
  if (!benchmark) {
    return (
      <p className="text-sm text-stone-600" data-testid="benchmark-empty">
        {t("notEnoughData", { min: minSample })}
      </p>
    );
  }
  const money = (n: number) => format.number(n, "salary");
  const scope = await scopeLabel(benchmark);
  return (
    <div data-testid="benchmark">
      <p className="text-sm font-medium text-stone-800">{scope}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["p25", benchmark.p25],
            ["median", benchmark.median],
            ["p75", benchmark.p75],
          ] as const
        ).map(([key, amount]) => (
          <div key={key} className="rounded-lg bg-stone-50 px-2 py-2">
            <dt className="text-xs text-stone-500">{t(`quartiles.${key}`)}</dt>
            <dd className="text-sm font-semibold tabular-nums sm:text-base">{money(amount)}</dd>
          </div>
        ))}
      </dl>
      <RangeBar benchmark={benchmark} value={value} />
      {position && value !== null ? (
        <p className={`mt-3 text-sm ${POSITION_TONE[position]}`}>
          {t(`${positionKey}.${position}`, { amount: money(value) })}
        </p>
      ) : positionKey === "offerPosition" ? (
        <p className="mt-3 text-sm text-stone-600">{t("offerPosition.noSalary")}</p>
      ) : null}
      <p className="mt-3 text-xs text-stone-500">
        {t("estimate", {
          count: benchmark.sampleSize,
          from: format.dateTime(benchmark.period.from, "month"),
          to: format.dateTime(benchmark.period.to, "month"),
        })}{" "}
        {benchmark.fallback && benchmark.scope !== "REGION"
          ? t(`fallback.${benchmark.scope}`)
          : null}
      </p>
    </div>
  );
}
