import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { Card } from "@/components/card";
import { PageHeader } from "@/components/page-header";
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
    <div className="max-w-4xl">
      <OrganizationNotice org={org} />
      <PageHeader
        band="brand"
        eyebrow={t("title")}
        title={org.name}
        actions={
          <Badge tone={org.status === "ACTIVE" ? "proven" : "warning"} size="md" dot>
            {t(`status.${org.status}`)}
          </Badge>
        }
      />
      <Card>
        <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="border-brand-line min-w-0 border-l-2 pl-4">
              <dt className="text-ink-muted text-sm font-medium">{label}</dt>
              <dd className="mt-1 text-lg font-semibold break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
