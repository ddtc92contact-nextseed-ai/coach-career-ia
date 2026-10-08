import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { isAiConfigured } from "@/lib/ai/server";
import { requireUser } from "@/lib/auth/session";
import { BackToMemory } from "../back-link";
import { ImportWizard } from "./import-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import");
  return { title: t("title") };
}

export default async function ImportPage() {
  await requireUser();
  const [t, tm] = await Promise.all([getTranslations("import"), getTranslations("memory")]);
  return (
    <>
      <BackToMemory />
      <PageHeader band="brand" eyebrow={tm("title")} title={t("title")} lead={t("intro")} />
      <ImportWizard aiConfigured={isAiConfigured()} />
    </>
  );
}
