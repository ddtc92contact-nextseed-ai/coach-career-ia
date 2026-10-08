import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { Link } from "@/i18n/navigation";
import { isAiConfigured } from "@/lib/ai/server";
import { requireUser } from "@/lib/auth/session";
import { ImportWizard } from "./import-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import");
  return { title: t("title") };
}

export default async function ImportPage() {
  await requireUser();
  const t = await getTranslations("import");
  return (
    <div className="max-w-4xl">
      <Link
        href="/app/memoire"
        className="text-ink-muted mb-4 inline-block text-sm underline-offset-4 hover:underline"
      >
        {t("back")}
      </Link>
      <PageTitle title={t("title")} intro={t("intro")} />
      <ImportWizard aiConfigured={isAiConfigured()} />
    </div>
  );
}
