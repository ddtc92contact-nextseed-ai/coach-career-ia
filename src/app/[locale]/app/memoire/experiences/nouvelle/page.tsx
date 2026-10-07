import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";
import { ExperienceForm } from "../../experience-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory.experiences");
  return { title: t("newTitle") };
}

export default async function NewExperiencePage() {
  await requireUser();
  const t = await getTranslations("memory.experiences");
  return (
    <div className="max-w-3xl">
      <PageTitle title={t("newTitle")} intro={t("formIntro")} />
      <ExperienceForm id={null} />
    </div>
  );
}
