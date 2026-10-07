import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState, PageTitle } from "@/components/empty-state";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { isProven } from "@/lib/career/derive";
import type { ContractTypeCode } from "@/lib/career/codes";
import { asSector, listAchievements, listExperiences, listSkills } from "@/lib/career/repository";
import { removeSkill } from "./actions";
import { SkillForm } from "./skill-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memory");
  return { title: t("title") };
}

const buttonClass =
  "inline-block rounded-lg bg-stone-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-stone-700";

export default async function CareerMemoryPage() {
  const user = await requireUser();
  const [t, tc, format, experiences, achievements, skills] = await Promise.all([
    getTranslations("memory"),
    getTranslations("codes"),
    getFormatter(),
    listExperiences(user.id),
    listAchievements(user.id),
    listSkills(user.id),
  ]);

  const period = (start: Date, end: Date | null) =>
    t("period", {
      start: format.dateTime(start, "month"),
      end: end ? format.dateTime(end, "month") : t("present"),
    });

  return (
    <>
      <PageTitle title={t("title")} intro={t("intro")} />

      <nav aria-label={t("sectionsNav")} className="mb-8 flex flex-wrap gap-2 text-sm">
        {(["experiences", "realisations", "competences"] as const).map((anchor) => (
          <a
            key={anchor}
            href={`#${anchor}`}
            className="rounded-full border border-stone-300 bg-white px-3 py-1 hover:bg-stone-100"
          >
            {t(`anchors.${anchor}`)}
          </a>
        ))}
      </nav>

      {/* Expériences */}
      <section id="experiences" aria-labelledby="experiences-title" className="scroll-mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="experiences-title" className="text-xl font-semibold">
            {t("experiences.title")}
          </h2>
          <Link href="/app/memoire/experiences/nouvelle" className={buttonClass}>
            {t("experiences.add")}
          </Link>
        </div>
        {experiences.length === 0 ? (
          <EmptyState title={t("experiences.emptyTitle")} text={t("experiences.emptyText")} />
        ) : (
          <ul className="grid gap-3">
            {experiences.map((experience) => (
              <li
                key={experience.id}
                className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="font-semibold break-words">{experience.roleTitle}</h3>
                    <p className="mt-0.5 text-sm text-stone-500">
                      {period(experience.startMonth, experience.endMonth)}
                    </p>
                    <p className="mt-2 text-sm text-stone-700">
                      {[
                        tc(`companyStage.${experience.companyStage}`),
                        tc(`sector.${asSector(experience.sector)}`),
                        tc(`companySize.${experience.companySize}`),
                      ].join(" · ")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge>{tc(`seniority.${experience.seniority}`)}</Badge>
                      <Badge>
                        {tc(`contractType.${experience.contractType as ContractTypeCode}`)}
                      </Badge>
                      <Badge>
                        {t("experiences.achievementCount", {
                          count: experience._count.achievements,
                        })}
                      </Badge>
                    </div>
                  </div>
                  <Link
                    href={`/app/memoire/experiences/${experience.id}`}
                    className="shrink-0 text-sm font-medium text-stone-700 underline underline-offset-4"
                  >
                    {t("edit")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Réalisations */}
      <section id="realisations" aria-labelledby="achievements-title" className="mt-12 scroll-mt-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 id="achievements-title" className="text-xl font-semibold">
            {t("achievements.title")}
          </h2>
          <Link href="/app/memoire/realisations/nouvelle" className={buttonClass}>
            {t("achievements.add")}
          </Link>
        </div>
        <p className="mb-4 text-sm text-stone-600">{t("achievements.intro")}</p>
        {achievements.length === 0 ? (
          <EmptyState title={t("achievements.emptyTitle")} text={t("achievements.emptyText")} />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {achievements.map((achievement) => (
              <li
                key={achievement.id}
                className="flex flex-col rounded-xl border border-stone-200 bg-white p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 font-semibold break-words">{achievement.title}</h3>
                  <Badge tone={isProven(achievement.evidenceLevel) ? "proven" : "warning"}>
                    {tc(`evidence.${achievement.evidenceLevel}`)}
                  </Badge>
                </div>
                {achievement.experience ? (
                  <p className="mt-0.5 text-sm text-stone-500">
                    {achievement.experience.roleTitle}
                  </p>
                ) : null}
                {achievement.result ? (
                  <p className="mt-2 text-sm text-stone-700">{achievement.result}</p>
                ) : null}
                {achievement.skills.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {achievement.skills.map((skill) => (
                      <Badge key={skill.id}>{skill.name}</Badge>
                    ))}
                  </div>
                ) : null}
                <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-sm">
                  <span className="text-stone-500">
                    {t("achievements.proofCount", { count: achievement.proofs.length })}
                  </span>
                  <Link
                    href={`/app/memoire/realisations/${achievement.id}`}
                    className="font-medium text-stone-700 underline underline-offset-4"
                  >
                    {achievement.proofs.length === 0 ? t("achievements.addProof") : t("edit")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Compétences */}
      <section id="competences" aria-labelledby="skills-title" className="mt-12 scroll-mt-6">
        <h2 id="skills-title" className="text-xl font-semibold">
          {t("skills.title")}
        </h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">{t("skills.intro")}</p>
        <div className="mb-4 rounded-xl border border-stone-200 bg-white p-4">
          <SkillForm />
        </div>
        {skills.length === 0 ? (
          <EmptyState title={t("skills.emptyTitle")} text={t("skills.emptyText")} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {skills.map((skill) => {
              const proven = skill.provenCount > 0;
              return (
                <li key={skill.id} className="rounded-xl border border-stone-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold break-words">{skill.name}</h3>
                      <p className="mt-0.5 text-sm text-stone-500">
                        {skill.current
                          ? t("skills.usedNow")
                          : skill.lastUsed
                            ? t("skills.lastUsed", {
                                date: format.dateTime(skill.lastUsed, "month"),
                              })
                            : t("skills.lastUsedUnknown")}
                      </p>
                    </div>
                    <Badge tone={proven ? "proven" : "warning"}>
                      {tc(`skillLevel.${skill.level}`)}
                    </Badge>
                  </div>
                  {skill.achievements.length > 0 ? (
                    <>
                      <p className="mt-3 text-xs font-medium tracking-wide text-stone-500 uppercase">
                        {t("skills.backedBy")}
                      </p>
                      <ul className="mt-1 space-y-1 text-sm">
                        {skill.achievements.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2">
                            <Link
                              href={`/app/memoire/realisations/${a.id}`}
                              className="min-w-0 truncate underline-offset-4 hover:underline"
                            >
                              {a.title}
                            </Link>
                            <span className="shrink-0 text-stone-500">
                              {t("achievements.proofCount", { count: a.proofCount })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-amber-800">{t("skills.unprovenHint")}</p>
                  )}
                  <div className="mt-3 flex justify-end">
                    <DeleteButton
                      small
                      action={removeSkill.bind(null, skill.id)}
                      confirmMessage={t("skills.confirmDelete", { name: skill.name })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
