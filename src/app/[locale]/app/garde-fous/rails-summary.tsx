import { getFormatter, getTranslations } from "next-intl/server";
import { Icon, type IconName } from "@/components/icons";
import type { ContractTypeCode } from "@/lib/career/codes";
import type { GuardRailsView } from "@/lib/career/repository";

const TONES = {
  default: "border-line bg-subtle",
  brand: "border-brand-line bg-surface/80",
} as const;

/**
 * Les garde-fous en blocs visuels (salaire plancher, télétravail, lieux,
 * contrats, exclusions) : tableau de bord et en-tête de « Mes garde-fous ».
 * Un garde-fou non défini est affiché comme tel, en atténué.
 */
export async function RailsSummary({
  rails,
  tone = "default",
}: {
  rails: GuardRailsView;
  tone?: keyof typeof TONES;
}) {
  const [t, tc, format] = await Promise.all([
    getTranslations("guardRails"),
    getTranslations("codes"),
    getFormatter(),
  ]);
  // `UNKNOWN` ne concerne que les offres : un garde-fou est défini ou absent.
  const remote = rails.remotePolicy === "UNKNOWN" ? null : rails.remotePolicy;
  const excludedCount = rails.excludedSectors.length + rails.excludedCompanies.length;
  const items: { key: string; icon: IconName; label: string; value: string | null }[] = [
    {
      key: "salary",
      icon: "euro",
      label: t("overview.salary"),
      value:
        rails.minFixedSalary !== null
          ? t("overview.salaryValue", { amount: format.number(rails.minFixedSalary, "salary") })
          : null,
    },
    {
      key: "remote",
      icon: "home",
      label: t("remote.title"),
      value: remote
        ? remote === "HYBRID" && rails.minRemoteDays
          ? t("overview.hybridDays", {
              policy: tc(`remotePolicy.${remote}`),
              count: rails.minRemoteDays,
            })
          : tc(`remotePolicy.${remote}`)
        : null,
    },
    {
      key: "locations",
      icon: "pin",
      label: t("overview.locations"),
      value:
        rails.locations.length > 0
          ? format.list(
              rails.locations.map((l) =>
                t("overview.location", { label: l.label, km: l.radiusKm }),
              ),
            )
          : null,
    },
    {
      key: "contracts",
      icon: "briefcase",
      label: t("overview.contracts"),
      value:
        rails.contractTypes.length > 0
          ? format.list(rails.contractTypes.map((c) => tc(`contractType.${c as ContractTypeCode}`)))
          : t("overview.contractsAll"),
    },
    {
      key: "exclusions",
      icon: "ban",
      label: t("exclusions.title"),
      value:
        excludedCount > 0
          ? t("overview.exclusionsValue", {
              sectors: rails.excludedSectors.length,
              companies: rails.excludedCompanies.length,
            })
          : null,
    },
  ];

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-3">
      {items.map((item) => (
        <li key={item.key} className={`flex gap-3 rounded-2xl border p-4 ${TONES[tone]}`}>
          <span
            className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${
              item.value ? "bg-brand-soft text-brand-ink" : "bg-muted text-ink-subtle"
            }`}
          >
            <Icon name={item.icon} className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-ink-muted text-sm hyphens-auto">{item.label}</p>
            <p
              className={`mt-0.5 font-semibold break-words ${
                item.value ? "text-ink" : "text-ink-subtle font-normal italic"
              }`}
            >
              {item.value ?? t("overview.unset")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
