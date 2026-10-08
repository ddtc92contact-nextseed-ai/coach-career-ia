import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardHeader } from "@/components/card";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { VaultEmployerName } from "@/components/vault/vault-widgets";
import { requireUser } from "@/lib/auth/session";
import { dateToMonth } from "@/lib/career/derive";
import { getExperience } from "@/lib/career/repository";
import { removeExperience } from "../../actions";
import { BackToMemory } from "../../back-link";
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
    <div className="max-w-4xl">
      <BackToMemory anchor="experiences" />
      <PageHeader eyebrow={t("editTitle")} title={experience.roleTitle} lead={t("formIntro")}>
        <VaultEmployerName experienceId={experience.id} />
      </PageHeader>
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
      <Card aria-labelledby="supprimer-experience" className="border-danger-line! mt-10">
        <CardHeader
          id="supprimer-experience"
          title={t("deleteTitle")}
          description={t("deleteText")}
        />
        <div className="mt-4">
          <DeleteButton
            action={removeExperience.bind(null, experience.id)}
            confirmMessage={t("confirmDelete")}
          />
        </div>
      </Card>
    </div>
  );
}
