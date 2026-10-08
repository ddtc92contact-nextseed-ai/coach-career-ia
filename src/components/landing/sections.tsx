import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/button";
import { Icon, type IconName } from "@/components/icons";
import { SIGN_UP_PATH } from "@/config/routes";
import { Link } from "@/i18n/navigation";

/** Ancres des sections de l'accueil (en-tête et liens internes). */
export const SECTION_IDS = {
  how: "comment-ca-marche",
  privacy: "confidentialite",
  coach: "coach",
  pricing: "tarifs",
  companies: "entreprises",
  faq: "faq",
} as const;

export function SectionHeading({
  id,
  eyebrow,
  title,
  intro,
  tone = "default",
  align = "start",
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro?: string;
  tone?: "default" | "night";
  align?: "start" | "center";
}) {
  const night = tone === "night";
  return (
    <div className={`reveal max-w-3xl ${align === "center" ? "mx-auto text-center" : ""}`}>
      <p
        className={`text-[0.9375rem] font-semibold tracking-wide uppercase ${night ? "text-signal" : "text-brand-ink"}`}
      >
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-4 text-4xl leading-[1.1] font-bold tracking-tight text-balance hyphens-auto sm:text-5xl"
      >
        {title}
      </h2>
      {intro ? (
        <p
          className={`mt-5 text-lg text-pretty sm:text-xl ${night ? "text-on-night-muted" : "text-ink-muted"}`}
        >
          {intro}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Bandeaux de l'accueil, alternés pour ne jamais enchaîner deux fonds blancs :
 * brume (canvas) / vert doux (brand) / blanc (surface) / nuit.
 */
const BANDS = {
  canvas: "bg-canvas",
  surface: "bg-surface border-y border-line",
  brand: "bg-brand-soft border-y border-brand-line",
  night: "band-night on-night text-on-night",
} as const;

export type Band = keyof typeof BANDS;

export function Section({
  id,
  band = "canvas",
  className = "",
  children,
}: {
  id: string;
  band?: Band;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titre`}
      data-band={band}
      className={`relative isolate ${BANDS[band]} ${className}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">{children}</div>
    </section>
  );
}

const STEPS = [
  { key: "memory", icon: "memory" },
  { key: "guardRails", icon: "shield" },
  { key: "radar", icon: "radar" },
  { key: "contact", icon: "send" },
] as const satisfies readonly { key: string; icon: IconName }[];

export function HowItWorks() {
  const t = useTranslations("landing.how");
  const heading = `${SECTION_IDS.how}-titre`;
  return (
    <Section id={SECTION_IDS.how} band="brand">
      <SectionHeading id={heading} eyebrow={t("eyebrow")} title={t("title")} intro={t("intro")} />
      <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li
            key={step.key}
            className="reveal group border-brand-line bg-surface relative flex flex-col rounded-2xl border p-6 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-7"
          >
            <div className="flex items-center justify-between">
              <span className="bg-night text-signal grid size-12 place-items-center rounded-xl transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5">
                <Icon name={step.icon} className="size-6" />
              </span>
              <span
                aria-hidden="true"
                className="font-display text-brand-line text-5xl font-bold tabular-nums"
              >
                {index + 1}
              </span>
            </div>
            <h3 className="mt-6 text-xl font-semibold tracking-tight text-balance hyphens-auto">
              {t(`steps.${step.key}.title`)}
            </h3>
            <p className="text-ink-muted mt-2 text-pretty">{t(`steps.${step.key}.text`)}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const PRIVACY = [
  { key: "vault", icon: "lock" },
  { key: "cards", icon: "card" },
  { key: "hosting", icon: "server" },
  { key: "ai", icon: "spark" },
  { key: "approval", icon: "approve" },
] as const satisfies readonly { key: string; icon: IconName }[];

export function PrivacyProof() {
  const t = useTranslations("landing.privacy");
  const heading = `${SECTION_IDS.privacy}-titre`;
  return (
    <Section id={SECTION_IDS.privacy} band="night" className="overflow-hidden">
      <SectionHeading
        id={heading}
        tone="night"
        eyebrow={t("eyebrow")}
        title={t("title")}
        intro={t("intro")}
      />
      <ul className="border-night-line bg-night-line mt-14 grid gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 lg:grid-cols-3">
        {PRIVACY.map((item, index) => (
          <li
            key={item.key}
            className={`reveal bg-night p-6 sm:p-8 ${index === 0 ? "lg:row-span-2" : ""}`}
          >
            <span className="border-night-line bg-night-raised text-signal grid size-11 place-items-center rounded-xl border">
              <Icon name={item.icon} className="size-5.5" />
            </span>
            <h3 className="mt-5 text-xl font-semibold tracking-tight text-balance hyphens-auto">
              {t(`items.${item.key}.title`)}
            </h3>
            <p className="text-on-night-muted mt-2 text-pretty">{t(`items.${item.key}.text`)}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const CONVERSATION = [
  { key: "m1", from: "coach", star: "s" },
  { key: "m2", from: "you" },
  { key: "m3", from: "coach", star: "t" },
  { key: "m4", from: "you", star: "a" },
  { key: "m5", from: "coach", star: "r" },
  { key: "m6", from: "you" },
] as const;

export function CoachSample() {
  const t = useTranslations("landing.coach");
  const heading = `${SECTION_IDS.coach}-titre`;
  return (
    <Section id={SECTION_IDS.coach}>
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
        <div>
          <SectionHeading
            id={heading}
            eyebrow={t("eyebrow")}
            title={t("title")}
            intro={t("intro")}
          />
          <ul className="reveal mt-8 space-y-3">
            {(["questions", "numbers", "control"] as const).map((point) => (
              <li key={point} className="flex gap-3">
                <span className="bg-brand-soft text-brand-ink mt-1 grid size-6 shrink-0 place-items-center rounded-full">
                  <Icon name="check" className="size-4" strokeWidth={2.25} />
                </span>
                <span className="text-ink-muted">{t(`points.${point}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="reveal border-line bg-surface rounded-3xl border p-4 shadow-lg sm:p-6">
          <p className="sr-only">{t("chatLabel")}</p>
          <ol className="space-y-3">
            {CONVERSATION.map((message) => {
              const coach = message.from === "coach";
              return (
                <li key={message.key} className={`flex ${coach ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-base leading-relaxed ${
                      coach
                        ? "bg-muted text-ink rounded-tl-sm"
                        : "bg-primary text-on-primary rounded-tr-sm"
                    }`}
                  >
                    <p
                      className={`mb-1 flex flex-wrap items-center gap-2 text-sm font-medium ${coach ? "text-ink-subtle" : "text-on-primary/75"}`}
                    >
                      {coach ? t("coachName") : t("you")}
                      {"star" in message ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${coach ? "bg-brand-soft text-brand-ink" : "bg-on-primary/15 text-on-primary"}`}
                        >
                          {t(`star.${message.star}`)}
                        </span>
                      ) : null}
                    </p>
                    {t(`messages.${message.key}`)}
                  </div>
                </li>
              );
            })}
          </ol>
          <p
            role="note"
            className="border-brand-line bg-brand-soft text-brand-ink mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-base font-medium"
          >
            <Icon name="memory" className="mt-0.5 size-4 shrink-0" />
            {t("saved")}
          </p>
        </div>
      </div>
    </Section>
  );
}

export function ForCompanies({ priceLine }: { priceLine: string }) {
  const t = useTranslations("landing.companies");
  const heading = `${SECTION_IDS.companies}-titre`;
  return (
    <Section id={SECTION_IDS.companies} band="brand">
      <div className="reveal border-brand-line bg-surface grid gap-10 rounded-3xl border p-6 shadow-md sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:p-12">
        <div>
          <p className="text-brand-ink flex items-center gap-2 text-[0.9375rem] font-semibold tracking-wide uppercase">
            <Icon name="building" className="size-4.5" />
            {t("eyebrow")}
          </p>
          <h2
            id={heading}
            className="mt-4 text-3xl leading-[1.12] font-bold tracking-tight text-balance hyphens-auto sm:text-4xl"
          >
            {t("title")}
          </h2>
          <p className="text-ink-muted mt-4 text-pretty">{t("text")}</p>
          <Link
            href="/entreprise/inscription"
            className={`${buttonClass("secondary", "lg")} mt-8 max-sm:w-full`}
          >
            {t("cta")}
            <Icon name="arrow" className="size-4" />
          </Link>
        </div>
        <ul className="space-y-4">
          {[t("points.salary"), t("points.anonymous"), priceLine].map((point) => (
            <li key={point} className="bg-canvas flex gap-3 rounded-xl p-4 sm:p-5">
              <Icon name="check" className="text-brand-ink mt-1 size-5 shrink-0" />
              <span className="text-pretty">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

const FAQ = [
  "free",
  "employer",
  "zeroKnowledge",
  "approval",
  "ai",
  "negotiation",
  "delete",
] as const;

export function Faq() {
  const t = useTranslations("landing.faq");
  const heading = `${SECTION_IDS.faq}-titre`;
  return (
    <Section id={SECTION_IDS.faq}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <SectionHeading id={heading} eyebrow={t("eyebrow")} title={t("title")} />
        <div className="reveal divide-line border-line bg-surface divide-y rounded-2xl border shadow-sm">
          {FAQ.map((item) => (
            <details key={item} name="faq" className="group">
              <summary className="hover:bg-subtle flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-5 font-semibold sm:px-7 [&::-webkit-details-marker]:hidden">
                <h3 className="text-lg text-pretty sm:text-xl">{t(`items.${item}.q`)}</h3>
                <Icon
                  name="chevron"
                  className="text-ink-subtle size-5 shrink-0 transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <p className="text-ink-muted px-5 pb-6 text-pretty sm:px-7">{t(`items.${item}.a`)}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function ClosingCta() {
  const t = useTranslations("landing.closing");
  return (
    <section
      aria-labelledby="cta-final-titre"
      data-band="night"
      className="band-night on-night text-on-night relative isolate overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="from-signal/20 absolute inset-x-0 -bottom-56 -z-10 mx-auto size-[40rem] rounded-full bg-radial to-transparent to-70%"
      />
      <div className="reveal mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
        <h2
          id="cta-final-titre"
          className="mx-auto max-w-3xl text-4xl leading-[1.1] font-bold tracking-tight text-balance hyphens-auto sm:text-5xl"
        >
          {t("title")}
        </h2>
        <p className="text-on-night-muted mx-auto mt-5 max-w-2xl text-lg text-pretty sm:text-xl">
          {t("text")}
        </p>
        <Link href={SIGN_UP_PATH} className={`${buttonClass("signal", "lg")} mt-8 max-sm:w-full`}>
          {t("cta")}
          <Icon name="arrow" className="size-4" />
        </Link>
      </div>
    </section>
  );
}
