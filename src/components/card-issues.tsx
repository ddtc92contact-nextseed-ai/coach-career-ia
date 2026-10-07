"use client";

import { useTranslations } from "next-intl";
import type { ReidentificationIssue } from "@/lib/card/reidentify";

type FieldKey =
  | "headline"
  | "achievementTitle"
  | "achievementResult"
  | "achievementSkill"
  | "achievementProof"
  | "skill"
  | "location"
  | "subject"
  | "body";

/** Champ concerné par un problème (`achievements.0.result` → réalisation 1, résultat). */
export function issueField(path: string): { key: FieldKey; n: number } {
  const [root, index, sub] = path.split(".");
  const n = Number(index ?? 0) + 1;
  if (root === "achievements") {
    const key =
      sub === "title"
        ? "achievementTitle"
        : sub === "result"
          ? "achievementResult"
          : sub === "skills"
            ? "achievementSkill"
            : "achievementProof";
    return { key, n };
  }
  if (root === "skills") return { key: "skill", n };
  if (root === "rails") return { key: "location", n };
  if (root === "subject" || root === "body") return { key: root, n };
  return { key: "headline", n };
}

/** Liste des problèmes de ré-identification, lisible par le candidat (seul à la voir). */
export function CardIssues({ issues, title }: { issues: ReidentificationIssue[]; title?: string }) {
  const t = useTranslations("card");
  if (issues.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">{title ?? t("issues.title")}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
        {issues.map((issue, i) => {
          const field = issueField(issue.path);
          return (
            <li key={`${issue.path}-${issue.code}-${i}`}>
              {t("issues.where", {
                field: t(`fields.${field.key}`, { n: field.n }),
                problem: t(`issues.${issue.code}`, { excerpt: issue.excerpt ?? "" }),
              })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
