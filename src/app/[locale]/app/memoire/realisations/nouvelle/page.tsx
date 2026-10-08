import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { listExperiences } from "@/lib/career/repository";
import { AchievementForm } from "../../achievement-form";
import { BackToMemory } from "../../back-link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory.achievements");
  return { title: t("newTitle") };
}

export default async function NewAchievementPage() {
  const user = await requireUser();
  const [t, experiences] = await Promise.all([getTranslations("memory"), listExperiences(user.id)]);
  return (
    <div className="max-w-4xl">
      <BackToMemory anchor="realisations" />
      <PageHeader
        eyebrow={t("title")}
        title={t("achievements.newTitle")}
        lead={t("achievements.formIntro")}
      />
      <AchievementForm
        id={null}
        experiences={experiences.map((e) => ({ id: e.id, label: e.roleTitle }))}
      />
    </div>
  );
}
