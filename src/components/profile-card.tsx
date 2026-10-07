import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { publicCard, type CardContent } from "@/lib/card/schema";

/**
 * Carte anonyme telle que l'entreprise la voit (aperçu du candidat et page
 * publique `/p/<jeton>`). N'affiche que la version publique : liens de preuve
 * et garde-fous masqués retirés.
 */
export async function ProfileCardView({ card }: { card: CardContent }) {
  const shown = publicCard(card);
  const [t, codes, format] = await Promise.all([
    getTranslations("publicCard"),
    getTranslations("codes"),
    getFormatter(),
  ]);
  const { rails } = shown;
  const conditions = [
    rails.salaryFloor !== null
      ? t("salary", {
          amount: format.number(rails.salaryFloor, {
            style: "currency",
            currency: "EUR",
            maximumFractionDigits: 0,
          }),
        })
      : null,
    rails.remotePolicy
      ? t("remote", { policy: codes(`remotePolicy.${rails.remotePolicy}`) })
      : null,
    rails.minRemoteDays ? t("remoteDays", { days: rails.minRemoteDays }) : null,
    rails.contractTypes.length > 0
      ? t("contracts", {
          contracts: format.list(rails.contractTypes.map((c) => codes(`contractType.${c}`))),
        })
      : null,
    ...rails.locations.map((l) => t("location", { label: l.label, km: l.radiusKm })),
  ].filter((line): line is string => Boolean(line));

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-7">
      <Badge>{t("badge")}</Badge>
      <h2 className="mt-3 text-xl font-semibold tracking-tight break-words">{shown.headline}</h2>
      <p className="mt-1 text-sm text-stone-600">
        {[
          shown.seniority ? codes(`seniority.${shown.seniority}`) : null,
          shown.yearsOfExperience ? t("years", { years: shown.yearsOfExperience }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {shown.achievements.length > 0 ? (
        <section className="mt-6">
          <h3 className="text-sm font-semibold">{t("achievements")}</h3>
          <ul className="mt-3 space-y-4">
            {shown.achievements.map((a, i) => (
              <li key={i}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">{a.title}</span>
                  <Badge tone={a.evidenceLevel === "DECLARED" ? "warning" : "proven"}>
                    {codes(`evidence.${a.evidenceLevel}`)}
                  </Badge>
                </div>
                {a.result ? (
                  <p className="mt-1 text-sm break-words text-stone-700">{a.result}</p>
                ) : null}
                {a.skills.length > 0 ? (
                  <p className="mt-1 text-xs text-stone-500">{a.skills.join(" · ")}</p>
                ) : null}
                {a.proofUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="mt-1 mr-3 inline-block text-xs text-stone-600 underline"
                  >
                    {t("proof")}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {shown.skills.length > 0 ? (
        <section className="mt-6">
          <h3 className="text-sm font-semibold">{t("skills")}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {shown.skills.map((s) => (
              <li key={s.name}>
                <Badge tone={s.proven ? "proven" : "neutral"}>
                  {s.name} · {s.proven ? t("proven") : t("declared")}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {conditions.length > 0 ? (
        <section className="mt-6">
          <h3 className="text-sm font-semibold">{t("conditions")}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
            {conditions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
