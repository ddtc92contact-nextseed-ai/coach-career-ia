import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { isAiConfigured } from "@/lib/ai/server";
import { requireUser } from "@/lib/auth/session";
import { guardRailsSet } from "@/lib/career/derive";
import { getDashboard } from "@/lib/career/repository";
import { BackToMemory } from "../back-link";
import { ImportWizard } from "./import-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import");
  return { title: t("title") };
}

export default async function ImportPage() {
  const user = await requireUser();
  const [t, tm, dashboard] = await Promise.all([
    getTranslations("import"),
    getTranslations("memory"),
    getDashboard(user.id),
  ]);
  // Garde-fous à poser : l'écran de fin de l'import y mène (étape 2 du démarrage).
  const railsDone = guardRailsSet(dashboard.completeness);
  return (
    <>
      <BackToMemory />
      <PageHeader band="brand" eyebrow={tm("title")} title={t("title")} lead={t("intro")} />
      <ImportWizard aiConfigured={isAiConfigured()} railsDone={railsDone} />
    </>
  );
}
