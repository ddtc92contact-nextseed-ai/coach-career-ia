import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/icons";
import { BrandMark, Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteFooter } from "@/components/site-footer";

/** Promesse du panneau « nuit », selon le public de la page. */
export type AuthAudience = "candidate" | "company";

const POINTS = {
  candidate: [
    { key: "landing.privacy.items.vault.title", icon: "lock" },
    { key: "landing.privacy.items.cards.title", icon: "card" },
    { key: "landing.privacy.items.approval.title", icon: "approve" },
  ],
  company: [
    { key: "landing.companies.points.salary", icon: "wallet" },
    { key: "landing.companies.points.anonymous", icon: "card" },
    { key: "landing.privacy.items.hosting.title", icon: "server" },
  ],
} as const satisfies Record<AuthAudience, readonly { key: string; icon: IconName }[]>;

/**
 * Cadre des pages de connexion et d'inscription (docs/brand.md §12) : sur
 * bureau, le formulaire d'un côté et le panneau « nuit » de la promesse de
 * l'autre ; sur téléphone, le formulaire seul, en pleine largeur.
 * `panel={false}` : carte centrée simple (404, désabonnement…).
 */
export function AuthCard({
  title,
  panel = "candidate",
  children,
}: Readonly<{ title: string; panel?: AuthAudience | false; children: React.ReactNode }>) {
  if (!panel) return <CenteredCard title={title}>{children}</CenteredCard>;
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="bg-surface grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8 lg:px-12 lg:py-6">
            <Logo />
            <LocaleSwitcher />
          </div>
          <main className="flex flex-1 flex-col justify-center px-4 pt-6 pb-14 sm:px-8 lg:px-12 lg:py-12">
            <div className="mx-auto w-full max-w-[30rem]">
              <h1 className="text-3xl font-bold tracking-tight text-balance hyphens-auto sm:text-4xl">
                {title}
              </h1>
              <div className="mt-5 text-base sm:text-[1.0625rem]">{children}</div>
            </div>
          </main>
        </div>
        <PromisePanel audience={panel} />
      </div>
      <SiteFooter />
    </div>
  );
}

function PromisePanel({ audience }: { audience: AuthAudience }) {
  const t = useTranslations();
  return (
    <aside
      aria-labelledby="promesse-titre"
      className="band-night on-night text-on-night relative isolate hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16"
    >
      <div
        aria-hidden="true"
        className="from-signal/15 absolute -right-40 -bottom-40 -z-10 size-[32rem] rounded-full bg-radial to-transparent to-70%"
      />
      <p className="font-display flex items-center gap-3 text-lg font-bold tracking-tight">
        <BrandMark className="ring-night-line size-9 rounded-[0.6rem] ring-1" />
        {t("metadata.siteName")}
      </p>
      <div className="my-12 max-w-lg">
        <p className="text-signal text-sm font-semibold tracking-wide uppercase">
          {audience === "company" ? t("landing.companies.eyebrow") : t("landing.hero.eyebrow")}
        </p>
        <h2
          id="promesse-titre"
          className="mt-4 text-4xl leading-[1.08] font-bold tracking-tight text-balance hyphens-auto xl:text-5xl"
        >
          {audience === "company"
            ? t("landing.companies.title")
            : t.rich("landing.hero.title", {
                signal: (chunks) => <span className="text-signal">{chunks}</span>,
              })}
        </h2>
        <ul className="mt-10 space-y-4">
          {POINTS[audience].map((point) => (
            <li key={point.key} className="flex items-center gap-4 text-lg">
              <span className="border-night-line bg-night-raised text-signal grid size-11 shrink-0 place-items-center rounded-xl border">
                <Icon name={point.icon} className="size-5.5" />
              </span>
              <span className="text-pretty">{t(point.key)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-on-night-muted max-w-md text-base text-pretty">{t("footer.tagline")}</p>
    </aside>
  );
}

function CenteredCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(44rem_22rem_at_50%_0%,var(--cc-brand-soft),transparent_70%)]"
      />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="mb-8 flex w-full max-w-lg items-center justify-between gap-3">
          <Logo />
          <LocaleSwitcher />
        </div>
        <div className="border-line bg-surface w-full max-w-lg rounded-3xl border p-6 text-[1.0625rem] shadow-md sm:p-10">
          <h1 className="text-3xl font-bold tracking-tight text-balance hyphens-auto sm:text-4xl">
            {title}
          </h1>
          <div className="mt-5">{children}</div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
