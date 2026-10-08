import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardHeader } from "@/components/card";
import { DeleteButton } from "@/components/delete-button";
import { EvidenceBadge } from "@/components/evidence-badge";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import type { ProofKindCode } from "@/lib/career/codes";
import { getAchievement, listExperiences } from "@/lib/career/repository";
import { removeAchievement, removeProof } from "../../actions";
import { AchievementForm } from "../../achievement-form";
import { BackToMemory } from "../../back-link";
import { ProofForms } from "../../proof-forms";

type Props = { params: Promise<{ id: string }> };

const PROOF_ICONS: Record<ProofKindCode, IconName> = {
  URL: "link",
  DOCUMENT: "proof",
  REFERENCE: "chat",
};

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
  const [t, tp, format] = await Promise.all([
    getTranslations("memory.achievements"),
    getTranslations("memory.proofs"),
    getFormatter(),
  ]);

  return (
    <>
      <BackToMemory anchor="realisations" />
      <PageHeader eyebrow={t("editTitle")} title={achievement.title} lead={t("formIntro")}>
        <p className="mt-4 flex flex-wrap items-center gap-3">
          <EvidenceBadge level={achievement.evidenceLevel} />
          <span className="text-ink-muted inline-flex items-center gap-1.5 text-sm">
            <Icon name="proof" className="size-4" />
            {t("proofCount", { count: achievement.proofs.length })}
          </span>
        </p>
      </PageHeader>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="xl:col-start-2 xl:row-start-1">
          <Card id="preuves" aria-labelledby="proofs-title" className="scroll-mt-6">
            <CardHeader
              id="proofs-title"
              icon="proof"
              title={tp("title")}
              description={tp("intro")}
            />

            {achievement.proofs.length === 0 ? (
              <p className="border-warning-line bg-warning-soft text-warning-ink mt-5 flex items-start gap-2 rounded-xl border border-dashed px-4 py-3 text-sm">
                <Icon name="clock" className="mt-0.5 size-4 shrink-0" />
                {tp("empty")}
              </p>
            ) : (
              <ul className="mt-5 space-y-3">
                {achievement.proofs.map((proof) => (
                  <li
                    key={proof.id}
                    className="border-brand-line bg-brand-soft/50 flex flex-col gap-3 rounded-xl border p-3.5"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="bg-surface text-brand-ink ring-brand-line inline-flex size-9 shrink-0 items-center justify-center rounded-lg ring-1">
                        <Icon name={PROOF_ICONS[proof.kind]} className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-brand-ink text-xs font-semibold tracking-wide uppercase">
                          {tp(`kinds.${proof.kind}`)}
                        </p>
                        {proof.kind === "URL" && proof.url ? (
                          <a
                            href={proof.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-brand-ink block break-all underline underline-offset-4"
                          >
                            {proof.url}
                          </a>
                        ) : null}
                        {proof.kind === "DOCUMENT" ? (
                          <a
                            href={`/api/proofs/${proof.id}`}
                            className="text-brand-ink block break-all underline underline-offset-4"
                          >
                            {proof.fileName}
                            {proof.sizeBytes ? (
                              <span className="text-ink-subtle">
                                {" "}
                                ({format.number(
                                  Math.max(1, Math.round(proof.sizeBytes / 1024)),
                                )}{" "}
                                {tp("kilobytes")})
                              </span>
                            ) : null}
                          </a>
                        ) : null}
                        {proof.kind === "REFERENCE" ? (
                          <p className="text-ink-muted text-sm break-words whitespace-pre-line">
                            {proof.referenceText}
                          </p>
                        ) : null}
                        <p className="text-ink-subtle mt-1 text-xs">
                          {tp("addedOn", { date: format.dateTime(proof.createdAt, "short") })}
                        </p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <DeleteButton
                        small
                        action={removeProof.bind(null, proof.id)}
                        confirmMessage={tp("confirmDelete")}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5">
              <ProofForms achievementId={achievement.id} />
            </div>
          </Card>
        </div>

        <div className="min-w-0 xl:col-start-1 xl:row-span-2 xl:row-start-1">
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
        </div>

        <Card
          aria-labelledby="supprimer-realisation"
          className="border-danger-line! xl:col-start-2 xl:row-start-2"
        >
          <CardHeader
            id="supprimer-realisation"
            title={t("deleteTitle")}
            description={t("deleteText")}
          />
          <div className="mt-4">
            <DeleteButton
              action={removeAchievement.bind(null, achievement.id)}
              confirmMessage={t("confirmDelete")}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
