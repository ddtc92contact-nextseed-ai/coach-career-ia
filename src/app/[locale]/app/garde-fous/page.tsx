import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";
import { getGuardRails } from "@/lib/career/repository";
import { GuardRailsForm } from "./guard-rails-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guardRails");
  return { title: t("title") };
}

export default async function GuardRailsPage() {
  const user = await requireUser();
  const [t, format, initial] = await Promise.all([
    getTranslations("guardRails"),
    getFormatter(),
    getGuardRails(user.id),
  ]);
  return (
    <div className="max-w-4xl">
      <PageTitle title={t("title")} intro={t("intro")} />
      {initial.updatedAt === null ? (
        <p className="mb-6 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
          {t("emptyHint")}
        </p>
      ) : null}
      {initial.minFixedSalary !== null ? (
        <div className="mb-6 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm">
          <p className="font-medium">{t("summary.title")}</p>
          <p className="mt-1 text-stone-600">
            {t("summary.minFixed", { amount: format.number(initial.minFixedSalary, "salary") })}
          </p>
          {initial.targetTotalPackage !== null ? (
            <p className="text-stone-600">
              {t("summary.targetPackage", {
                amount: format.number(initial.targetTotalPackage, "salary"),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      <GuardRailsForm initial={initial} />
    </div>
  );
}
