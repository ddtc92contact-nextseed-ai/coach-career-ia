import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { PageTitle } from "@/components/empty-state";
import type { SectorCode } from "@/lib/career/codes";
import { countryNames } from "@/lib/employer/countries";
import { requireEmployer } from "@/lib/employer/session";
import { OrganizationNotice } from "../parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer.org");
  return { title: t("title") };
}

export default async function OrganizationPage() {
  const { org } = await requireEmployer();
  const [t, tc, format, locale] = await Promise.all([
    getTranslations("employer.org"),
    getTranslations("codes"),
    getFormatter(),
    getLocale(),
  ]);
  const rows: [string, React.ReactNode][] = [
    [
      t("website"),
      <span key="w" className="break-all">
        {org.website}
      </span>,
    ],
    [t("domain"), org.domain],
    [t("sector"), tc(`sector.${org.sector as SectorCode}`)],
    [t("size"), tc(`companySize.${org.size}`)],
    [t("country"), countryNames(locale)[org.country] ?? org.country],
    [
      t("verified"),
      org.verifiedAt
        ? t("verifiedOn", { date: format.dateTime(org.verifiedAt, "short") })
        : t("notVerified"),
    ],
  ];
  return (
    <div className="max-w-3xl">
      <OrganizationNotice org={org} />
      <PageTitle
        title={org.name}
        action={
          <Badge tone={org.status === "ACTIVE" ? "proven" : "warning"}>
            {t(`status.${org.status}`)}
          </Badge>
        }
      />
      <dl className="divide-line border-line bg-surface divide-y rounded-2xl border text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between sm:gap-4"
          >
            <dt className="text-ink-subtle">{label}</dt>
            <dd className="font-medium sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
