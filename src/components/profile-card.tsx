import { getFormatter, getTranslations } from "next-intl/server";
import { EvidenceBadge } from "@/components/evidence-badge";
import { Icon, type IconName } from "@/components/icons";
import { publicCard, type CardContent } from "@/lib/card/schema";

type Condition = { icon: IconName; text: string };

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
  const conditions: Condition[] = [];
  if (rails.salaryFloor !== null) {
    const amount = format.number(rails.salaryFloor, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    });
    conditions.push({ icon: "euro", text: t("salary", { amount }) });
  }
  if (rails.remotePolicy) {
    const policy = codes(`remotePolicy.${rails.remotePolicy}`);
    conditions.push({ icon: "home", text: t("remote", { policy }) });
  }
  if (rails.minRemoteDays) {
    conditions.push({ icon: "home", text: t("remoteDays", { days: rails.minRemoteDays }) });
  }
  if (rails.contractTypes.length > 0) {
    const contracts = format.list(rails.contractTypes.map((c) => codes(`contractType.${c}`)));
    conditions.push({ icon: "briefcase", text: t("contracts", { contracts }) });
  }
  for (const l of rails.locations) {
    conditions.push({ icon: "pin", text: t("location", { label: l.label, km: l.radiusKm }) });
  }
  const proven = shown.achievements.filter((a) => a.evidenceLevel !== "DECLARED").length;
  const facts = [
    shown.seniority ? codes(`seniority.${shown.seniority}`) : null,
    shown.yearsOfExperience ? t("years", { years: shown.yearsOfExperience }) : null,
  ].filter(Boolean);

  return (
    <article className="border-line bg-surface overflow-hidden rounded-2xl border shadow-md">
      <header className="band-night on-night text-on-night px-5 py-6 sm:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <span className="bg-signal/15 text-signal inline-flex size-12 shrink-0 items-center justify-center rounded-2xl">
            <Icon name="user" className="size-6" />
          </span>
          <span className="bg-night-raised ring-night-line text-on-night-muted inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset">
            <Icon name="lock" className="size-4" />
            {t("badge")}
          </span>
        </div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-balance break-words">
          {shown.headline}
        </h2>
        {facts.length > 0 ? <p className="text-on-night-muted mt-1">{facts.join(" · ")}</p> : null}
        {shown.achievements.length > 0 ? (
          <p className="text-signal mt-4 inline-flex items-center gap-2 font-semibold">
            <Icon name="approve" className="size-5" />
            {t("provenCount", { count: proven })}
          </p>
        ) : null}
      </header>

      <div className="space-y-7 px-5 py-6 sm:px-7">
        {shown.achievements.length > 0 ? (
          <section>
            <h3 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
              {t("achievements")}
            </h3>
            <ul className="mt-3 space-y-3">
              {shown.achievements.map((a, i) => (
                <li key={i} className="border-line bg-subtle rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 font-semibold break-words">{a.title}</span>
                    <EvidenceBadge level={a.evidenceLevel} />
                  </div>
                  {a.result ? (
                    <p className="text-ink mt-2 break-words">
                      <Icon
                        name="arrow"
                        className="text-brand-ink mr-1.5 inline size-4 align-[-0.15em]"
                      />
                      {a.result}
                    </p>
                  ) : null}
                  {a.skills.length > 0 ? (
                    <p className="text-ink-muted mt-2 text-sm">{a.skills.join(" · ")}</p>
                  ) : null}
                  {a.proofUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-brand-ink mt-2 mr-4 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
                    >
                      <Icon name="link" className="size-4" />
                      {t("proof")}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {shown.skills.length > 0 ? (
          <section>
            <h3 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
              {t("skills")}
            </h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {shown.skills.map((s) => (
                <li
                  key={s.name}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${
                    s.proven
                      ? "bg-brand-soft text-brand-ink ring-brand-line"
                      : "bg-muted text-ink-muted ring-line"
                  }`}
                >
                  {s.proven ? <Icon name="check" className="size-3.5" /> : null}
                  {s.name}
                  <span className="sr-only"> · {s.proven ? t("proven") : t("declared")}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {conditions.length > 0 ? (
          <section>
            <h3 className="text-ink-subtle text-sm font-semibold tracking-wide uppercase">
              {t("conditions")}
            </h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {conditions.map((line) => (
                <li key={line.text} className="text-ink-muted flex items-start gap-2 text-sm">
                  <Icon name={line.icon} className="text-brand-ink mt-0.5 size-4 shrink-0" />
                  {line.text}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  );
}
