import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { BackToMemory } from "../../back-link";
import { ExperienceForm } from "../../experience-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory.experiences");
  return { title: t("newTitle") };
}

export default async function NewExperiencePage() {
  await requireUser();
  const t = await getTranslations("memory");
  return (
    <div className="max-w-4xl">
      <BackToMemory anchor="experiences" />
      <PageHeader
        eyebrow={t("title")}
        title={t("experiences.newTitle")}
        lead={t("experiences.formIntro")}
      />
      <ExperienceForm id={null} />
    </div>
  );
}
