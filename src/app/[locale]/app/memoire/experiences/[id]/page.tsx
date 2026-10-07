import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DeleteButton } from "@/components/delete-button";
import { PageTitle } from "@/components/empty-state";
import { VaultEmployerName } from "@/components/vault/vault-widgets";
import { requireUser } from "@/lib/auth/session";
import { dateToMonth } from "@/lib/career/derive";
import { getExperience } from "@/lib/career/repository";
import { removeExperience } from "../../actions";
import { ExperienceForm } from "../../experience-form";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory.experiences");
  return { title: t("editTitle") };
}

export default async function EditExperiencePage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const experience = await getExperience(user.id, id);
  if (!experience) notFound();
  const t = await getTranslations("memory.experiences");

  return (
    <div className="max-w-3xl">
      <PageTitle title={t("editTitle")} intro={t("formIntro")} />
      <div className="-mt-5 mb-6">
        <VaultEmployerName experienceId={experience.id} />
      </div>
      <ExperienceForm
        id={experience.id}
        defaults={{
          roleTitle: experience.roleTitle,
          startMonth: dateToMonth(experience.startMonth),
          endMonth: experience.endMonth ? dateToMonth(experience.endMonth) : "",
          seniority: experience.seniority,
          contractType: experience.contractType,
          sector: experience.sector,
          companySize: experience.companySize,
          companyStage: experience.companyStage,
          responsibilities: experience.responsibilities,
        }}
      />
      <div className="mt-10 border-t border-stone-200 pt-6">
        <h2 className="font-semibold">{t("deleteTitle")}</h2>
        <p className="mt-1 mb-3 text-sm text-stone-600">{t("deleteText")}</p>
        <DeleteButton
          action={removeExperience.bind(null, experience.id)}
          confirmMessage={t("confirmDelete")}
        />
      </div>
    </div>
  );
}
