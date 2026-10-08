import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import styles from "./hero-demo.module.css";

const CHECKS = [
  { key: "salary", className: styles.check1 },
  { key: "remote", className: styles.check2 },
  { key: "sector", className: styles.check3 },
] as const;

/**
 * Visuel d'accueil, construit en code : l'agent repère une offre, vérifie les
 * garde-fous, explique la correspondance et prépare un message anonyme qui
 * attend l'accord. Décoratif pour les lecteurs d'écran (une légende le décrit).
 */
export function HeroDemo() {
  const t = useTranslations("landing.demo");
  return (
    <figure className="relative">
      <figcaption className="sr-only">{t("label")}</figcaption>
      <div
        aria-hidden="true"
        className="from-brand/25 pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] bg-radial to-transparent to-70% blur-2xl"
      />
      <div
        aria-hidden="true"
        className="border-night-line bg-night text-on-night rounded-3xl border p-4 text-sm shadow-lg select-none sm:p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 font-medium">
            <span className={`${styles.pulse} bg-signal size-2.5 shrink-0 rounded-full`} />
            <span className="truncate">{t("status")}</span>
          </p>
          <span className="border-night-line relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border">
            <span
              className={`${styles.sweep} absolute inset-0 bg-[conic-gradient(from_0deg,transparent_70%,var(--cc-signal))] opacity-70`}
            />
            <span className="bg-signal relative size-1.5 rounded-full" />
          </span>
        </div>

        <div className="text-on-night-muted mt-3 flex items-center gap-3 text-xs">
          <Icon name="radar" className="size-4 shrink-0" />
          <span className="truncate">{t("radar", { count: 1284 })}</span>
          <span className="bg-night-raised relative ml-auto h-1 w-16 shrink-0 overflow-hidden rounded-full">
            <span className={`${styles.scan} bg-signal/70 absolute inset-y-0 w-1/3 rounded-full`} />
          </span>
        </div>

        <div
          className={`${styles.offer} border-night-line bg-night-raised mt-4 rounded-2xl border p-4`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-signal text-[0.6875rem] font-semibold tracking-wider uppercase">
                {t("found")}
              </p>
              <p className="font-display mt-1 text-base font-semibold">{t("offerTitle")}</p>
              <p className="text-on-night-muted mt-0.5 text-xs">{t("offerMeta")}</p>
            </div>
            <span className="border-night-line rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap">
              {t("offerSalary")}
            </span>
          </div>

          <p className="text-on-night-muted mt-4 text-xs font-medium">{t("checksTitle")}</p>
          <ul className="mt-2 space-y-1.5">
            {CHECKS.map((check) => (
              <li key={check.key} className={`${check.className} flex items-center gap-2`}>
                <span className="bg-signal/15 text-signal grid size-5 shrink-0 place-items-center rounded-full">
                  <Icon name="check" className="size-3.5" strokeWidth={2.5} />
                </span>
                <span>{t(`checks.${check.key}`)}</span>
              </li>
            ))}
          </ul>

          <div
            className={`${styles.match} border-night-line mt-4 flex items-center gap-3 border-t pt-4`}
          >
            <span
              className={`${styles.ring} grid size-12 shrink-0 place-items-center rounded-full`}
            >
              <span className="bg-night-raised grid size-9.5 place-items-center rounded-full text-xs font-semibold">
                {t("matchScore", { score: 0.87 })}
              </span>
            </span>
            <p className="text-on-night-muted text-xs leading-relaxed">
              <span className="text-on-night font-semibold">{t("match")}</span> · {t("why")}
            </p>
          </div>
        </div>

        <div className={`${styles.draft} border-night-line mt-3 rounded-2xl border p-4`}>
          <p className="text-on-night-muted flex items-center gap-2 text-xs font-medium">
            <Icon name="lock" className="size-4" />
            {t("draftTitle")}
          </p>
          <p className="mt-2 leading-relaxed">
            {t("draft")}
            <span
              className={`${styles.caret} bg-signal ml-0.5 inline-block h-4 w-0.5 align-[-2px]`}
            />
          </p>
          <div
            className={`${styles.approve} mt-3 flex flex-wrap items-center justify-between gap-2`}
          >
            <span className="text-on-night-muted text-xs">{t("waiting")}</span>
            <span className="bg-signal text-night inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold">
              <Icon name="check" className="size-3.5" strokeWidth={2.5} />
              {t("approve")}
            </span>
          </div>
        </div>
      </div>
    </figure>
  );
}
