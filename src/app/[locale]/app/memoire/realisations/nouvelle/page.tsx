import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";
import { listExperiences } from "@/lib/career/repository";
import { AchievementForm } from "../../achievement-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory.achievements");
  return { title: t("newTitle") };
}

export default async function NewAchievementPage() {
  const user = await requireUser();
  const [t, experiences] = await Promise.all([
    getTranslations("memory.achievements"),
    listExperiences(user.id),
  ]);
  return (
    <div className="max-w-3xl">
      <PageTitle title={t("newTitle")} intro={t("formIntro")} />
      <AchievementForm
        id={null}
        experiences={experiences.map((e) => ({ id: e.id, label: e.roleTitle }))}
      />
    </div>
  );
}
