import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmptyState, PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("opportunities");
  return { title: t("title") };
}

export default async function OpportunitiesPage() {
  await requireUser();
  const t = await getTranslations("opportunities");
  return (
    <>
      <PageTitle title={t("title")} intro={t("intro")} />
      <EmptyState title={t("emptyTitle")} text={t("emptyText")} />
    </>
  );
}
