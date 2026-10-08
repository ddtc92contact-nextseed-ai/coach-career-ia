import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { buttonClass } from "@/components/button";
import { Card, CardHeader } from "@/components/card";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { EvidenceBadge } from "@/components/evidence-badge";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { VaultEmployerName } from "@/components/vault/vault-widgets";
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

const editLinkClass =
  "text-ink-muted hover:text-ink inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium underline-offset-4 hover:underline";

export default async function CareerMemoryPage() {
  const user = await requireUser();
  const [t, td, tc, format, experiences, achievements, skills] = await Promise.all([
    getTranslations("memory"),
    getTranslations("dashboard.stats"),
    getTranslations("codes"),
    getFormatter(),
    listExperiences(user.id),
    listAchievements(user.id),
    listSkills(user.id),
  ]);
  const provenAchievements = achievements.filter((a) => isProven(a.evidenceLevel)).length;
  const provenSkills = skills.filter((s) => s.provenCount > 0).length;

  const period = (start: Date, end: Date | null) =>
    t("period", {
      start: format.dateTime(start, "month"),
      end: end ? format.dateTime(end, "month") : t("present"),
    });

  return (
    <>
      <PageHeader
        band="brand"
        eyebrow={t("eyebrow")}
        title={t("title")}
        lead={t("intro")}
        actions={
          <Link href="/app/memoire/realisations/nouvelle" className={buttonClass("primary", "lg")}>
            <Icon name="plus" className="size-5" />
            {t("achievements.add")}
          </Link>
        }
      >
        <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatTile
            tone="brand"
            icon="briefcase"
            value={format.number(experiences.length)}
            label={td("experiences", { count: experiences.length })}
          />
          <StatTile
            tone="brand"
            icon="spark"
            value={format.number(achievements.length)}
            label={td("achievements", { count: achievements.length })}
          />
          <StatTile
            tone="brand"
            icon="proof"
            value={format.number(provenAchievements)}
            label={td("proven", { count: provenAchievements })}
          />
          <StatTile
            tone="brand"
            icon="check"
            value={format.number(provenSkills)}
            label={t("stats.provenSkills", { count: provenSkills })}
          />
        </div>
        <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label={t("sectionsNav")} className="flex flex-wrap gap-2">
            {(["realisations", "experiences", "competences"] as const).map((anchor) => (
              <a
                key={anchor}
                href={`#${anchor}`}
                className="border-brand-line bg-surface hover:bg-brand-soft inline-flex min-h-11 items-center rounded-full border px-4 font-medium"
              >
                {t(`anchors.${anchor}`)}
              </a>
            ))}
          </nav>
          <div className="flex flex-col gap-1 lg:items-end">
            <Link href="/app/memoire/importer" className={buttonClass("secondary")}>
              <Icon name="upload" className="size-4" />
              {t("importCta")}
            </Link>
            <p className="text-ink-muted max-w-sm text-sm lg:text-right">{t("importHint")}</p>
          </div>
        </div>
      </PageHeader>

      {/* Réalisations : le cœur du profil, en premier. */}
      <Card id="realisations" aria-labelledby="achievements-title" className="scroll-mt-6">
        <CardHeader
          id="achievements-title"
          title={t("achievements.title")}
          description={t("achievements.intro")}
        />
        {achievements.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              icon="spark"
              title={t("achievements.emptyTitle")}
              text={t("achievements.emptyText")}
            />
          </div>
        ) : (
          <ul className="mt-6 grid gap-4 xl:grid-cols-2">
            {achievements.map((achievement) => {
              const story = [
                { key: "context", text: achievement.context },
                { key: "action", text: achievement.actions },
              ] as const;
              const noProof = achievement.proofs.length === 0;
              return (
                <li key={achievement.id} className="min-w-0">
                  <article
                    aria-labelledby={`realisation-${achievement.id}`}
                    className="border-line bg-surface flex h-full flex-col rounded-2xl border p-5 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3
                          id={`realisation-${achievement.id}`}
                          className="text-lg font-semibold break-words"
                        >
                          {achievement.title}
                        </h3>
                        {achievement.experience ? (
                          <p className="text-ink-muted mt-0.5 flex items-center gap-1.5 text-sm">
                            <Icon name="briefcase" className="size-4 shrink-0" />
                            <span className="min-w-0 break-words">
                              {achievement.experience.roleTitle}
                            </span>
                          </p>
                        ) : null}
                      </div>
                      <EvidenceBadge level={achievement.evidenceLevel} />
                    </div>

                    <dl className="mt-4 grid gap-3">
                      {story.map((part) => (
                        <div key={part.key} className="border-line border-l-2 pl-3">
                          <dt className="text-ink-subtle text-xs font-semibold tracking-wide uppercase">
                            {t(`achievements.story.${part.key}`)}
                          </dt>
                          <dd
                            className={`mt-0.5 line-clamp-3 break-words ${
                              part.text ? "text-ink-muted" : "text-ink-subtle italic"
                            }`}
                          >
                            {part.text || t("achievements.story.missing")}
                          </dd>
                        </div>
                      ))}
                      <div className="bg-brand-soft border-brand-line rounded-xl border px-3 py-2.5">
                        <dt className="text-brand-ink text-xs font-semibold tracking-wide uppercase">
                          {t("achievements.story.result")}
                        </dt>
                        <dd
                          className={`mt-0.5 break-words ${
                            achievement.result ? "text-ink font-semibold" : "text-ink-muted italic"
                          }`}
                        >
                          {achievement.result || t("achievements.story.missing")}
                        </dd>
                      </div>
                    </dl>

                    {achievement.skills.length > 0 ? (
                      <ul className="mt-4 flex flex-wrap gap-1.5">
                        {achievement.skills.map((skill) => (
                          <li key={skill.id}>
                            <Badge>{skill.name}</Badge>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="border-line mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-sm ${
                          noProof ? "text-warning-ink" : "text-ink-muted"
                        }`}
                      >
                        <Icon name="proof" className="size-4" />
                        {t("achievements.proofCount", { count: achievement.proofs.length })}
                      </span>
                      <Link
                        href={`/app/memoire/realisations/${achievement.id}${noProof ? "#preuves" : ""}`}
                        className={
                          noProof
                            ? "text-brand-ink inline-flex min-h-11 items-center gap-1.5 font-semibold underline-offset-4 hover:underline"
                            : editLinkClass
                        }
                      >
                        <Icon name={noProof ? "plus" : "edit"} className="size-4" />
                        {noProof ? t("achievements.addProof") : t("edit")}
                        <span className="sr-only"> — {achievement.title}</span>
                      </Link>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Expériences */}
      <Card id="experiences" aria-labelledby="experiences-title" className="mt-6 scroll-mt-6">
        <CardHeader
          id="experiences-title"
          title={t("experiences.title")}
          actions={
            <Link href="/app/memoire/experiences/nouvelle" className={buttonClass("secondary")}>
              <Icon name="plus" className="size-4" />
              {t("experiences.add")}
            </Link>
          }
        />
        {experiences.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              icon="briefcase"
              title={t("experiences.emptyTitle")}
              text={t("experiences.emptyText")}
            />
          </div>
        ) : (
          <ol className="mt-6 space-y-3">
            {experiences.map((experience) => (
              <li
                key={experience.id}
                className="border-line bg-subtle flex gap-4 rounded-2xl border p-4 sm:p-5"
              >
                <span className="bg-surface text-brand-ink ring-line hidden size-11 shrink-0 items-center justify-center rounded-xl ring-1 sm:inline-flex">
                  <Icon name="briefcase" className="size-5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold break-words">{experience.roleTitle}</h3>
                    <VaultEmployerName experienceId={experience.id} />
                    <p className="text-ink-muted mt-0.5 flex items-center gap-1.5 text-sm">
                      <Icon name="clock" className="size-4 shrink-0" />
                      {period(experience.startMonth, experience.endMonth)}
                    </p>
                    <p className="text-ink-muted mt-1 flex items-center gap-1.5 text-sm">
                      <Icon name="building" className="size-4 shrink-0" />
                      <span className="min-w-0">
                        {[
                          tc(`companyStage.${experience.companyStage}`),
                          tc(`sector.${asSector(experience.sector)}`),
                          tc(`companySize.${experience.companySize}`),
                        ].join(" · ")}
                      </span>
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge>{tc(`seniority.${experience.seniority}`)}</Badge>
                      <Badge>
                        {tc(`contractType.${experience.contractType as ContractTypeCode}`)}
                      </Badge>
                      <Badge tone={experience._count.achievements > 0 ? "proven" : "neutral"}>
                        {t("experiences.achievementCount", {
                          count: experience._count.achievements,
                        })}
                      </Badge>
                    </div>
                  </div>
                  <Link
                    href={`/app/memoire/experiences/${experience.id}`}
                    className={editLinkClass}
                  >
                    <Icon name="edit" className="size-4" />
                    {t("edit")}
                    <span className="sr-only"> — {experience.roleTitle}</span>
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* Compétences */}
      <Card id="competences" aria-labelledby="skills-title" className="mt-6 scroll-mt-6">
        <CardHeader id="skills-title" title={t("skills.title")} description={t("skills.intro")} />
        <div className="border-line bg-subtle mt-5 rounded-xl border p-4">
          <SkillForm />
        </div>
        {skills.length === 0 ? (
          <div className="mt-5">
            <EmptyState icon="check" title={t("skills.emptyTitle")} text={t("skills.emptyText")} />
          </div>
        ) : (
          <ul className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {skills.map((skill) => {
              const proven = skill.provenCount > 0;
              return (
                <li
                  key={skill.id}
                  className={`flex min-w-0 flex-col rounded-xl border p-4 ${
                    proven ? "border-brand-line bg-surface" : "border-line bg-subtle"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold break-words">{skill.name}</h3>
                      <p className="text-ink-muted mt-0.5 text-sm">
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
                      <p className="text-ink-subtle mt-3 text-xs font-semibold tracking-wide uppercase">
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
                            <span className="text-ink-subtle shrink-0">
                              {t("achievements.proofCount", { count: a.proofCount })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-warning-ink mt-3 text-sm">{t("skills.unprovenHint")}</p>
                  )}
                  <div className="mt-auto flex justify-end pt-3">
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
      </Card>
    </>
  );
}
