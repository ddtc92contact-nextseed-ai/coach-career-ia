import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { DeleteButton } from "@/components/delete-button";
import { PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";
import { isProven } from "@/lib/career/derive";
import { getAchievement, listExperiences } from "@/lib/career/repository";
import { removeAchievement, removeProof } from "../../actions";
import { AchievementForm } from "../../achievement-form";
import { ProofForms } from "../../proof-forms";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory.achievements");
  return { title: t("editTitle") };
}

export default async function EditAchievementPage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const [achievement, experiences] = await Promise.all([
    getAchievement(user.id, id),
    listExperiences(user.id),
  ]);
  if (!achievement) notFound();
  const [t, tp, tc, format] = await Promise.all([
    getTranslations("memory.achievements"),
    getTranslations("memory.proofs"),
    getTranslations("codes"),
    getFormatter(),
  ]);

  return (
    <div className="max-w-3xl">
      <PageTitle title={t("editTitle")} intro={t("formIntro")} />

      <section id="preuves" aria-labelledby="proofs-title" className="mb-10 scroll-mt-6">
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h2 id="proofs-title" className="text-lg font-semibold">
            {tp("title")}
          </h2>
          <Badge tone={isProven(achievement.evidenceLevel) ? "proven" : "warning"}>
            {tc(`evidence.${achievement.evidenceLevel}`)}
          </Badge>
        </div>
        <p className="mb-4 text-sm text-stone-600">{tp("intro")}</p>

        {achievement.proofs.length === 0 ? (
          <p className="mb-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {tp("empty")}
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
            {achievement.proofs.map((proof) => (
              <li
                key={proof.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
                    {tp(`kinds.${proof.kind}`)}
                  </p>
                  {proof.kind === "URL" && proof.url ? (
                    <a
                      href={proof.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-brand-700 block truncate underline underline-offset-4"
                    >
                      {proof.url}
                    </a>
                  ) : null}
                  {proof.kind === "DOCUMENT" ? (
                    <a
                      href={`/api/proofs/${proof.id}`}
                      className="text-brand-700 block truncate underline underline-offset-4"
                    >
                      {proof.fileName}
                      {proof.sizeBytes ? (
                        <span className="text-stone-500">
                          {" "}
                          ({format.number(Math.max(1, Math.round(proof.sizeBytes / 1024)))}{" "}
                          {tp("kilobytes")})
                        </span>
                      ) : null}
                    </a>
                  ) : null}
                  {proof.kind === "REFERENCE" ? (
                    <p className="text-sm whitespace-pre-line text-stone-700">
                      {proof.referenceText}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-stone-500">
                    {tp("addedOn", { date: format.dateTime(proof.createdAt, "short") })}
                  </p>
                </div>
                <DeleteButton
                  small
                  action={removeProof.bind(null, proof.id)}
                  confirmMessage={tp("confirmDelete")}
                />
              </li>
            ))}
          </ul>
        )}
        <ProofForms achievementId={achievement.id} />
      </section>

      <h2 className="mb-4 text-lg font-semibold">{t("detailsTitle")}</h2>
      <AchievementForm
        id={achievement.id}
        experiences={experiences.map((e) => ({ id: e.id, label: e.roleTitle }))}
        defaults={{
          title: achievement.title,
          context: achievement.context,
          actions: achievement.actions,
          result: achievement.result,
          skills: achievement.skills.map((s) => s.name).join(", "),
          experienceId: achievement.experienceId ?? "",
        }}
      />

      <div className="mt-10 border-t border-stone-200 pt-6">
        <h2 className="font-semibold">{t("deleteTitle")}</h2>
        <p className="mt-1 mb-3 text-sm text-stone-600">{t("deleteText")}</p>
        <DeleteButton
          action={removeAchievement.bind(null, achievement.id)}
          confirmMessage={t("confirmDelete")}
        />
      </div>
    </div>
  );
}
