import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";
import { Link } from "@/i18n/navigation";
import { initUserLocale } from "@/lib/career/repository";
import { countNewThreads } from "@/lib/employer/inbox";
import { requireEmployer } from "@/lib/employer/session";
import { logout } from "../../app/actions";
import { EmployerNav } from "./nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employer");
  return {
    title: { default: t("metaTitle"), template: t("titleTemplate") },
    robots: { index: false, follow: false },
  };
}

/**
 * Espace entreprise : réservé aux membres d'une organisation (404 pour un
 * compte uniquement candidat). Seules les personnes candidates qui ont
 * contacté l'organisation y apparaissent, dans la messagerie, anonymement.
 */
export default async function EmployerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, org } = await requireEmployer();
  const [t, locale, newThreads] = await Promise.all([
    getTranslations("employer"),
    getLocale(),
    countNewThreads(org.id),
  ]);
  await initUserLocale(user.id, locale);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-line bg-surface border-b">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Logo href="/entreprise" />
              <span className="text-ink-muted hidden truncate text-sm font-medium sm:inline">
                {org.name}
              </span>
              {org.status !== "ACTIVE" ? (
                <Badge tone="warning">{t(`org.status.${org.status}`)}</Badge>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Link
                href="/app"
                className="text-ink-muted hover:text-ink hidden text-sm hover:underline md:inline"
              >
                {t("nav.candidate")}
              </Link>
              <LocaleSwitcher persist />
              <form action={logout}>
                <button
                  type="submit"
                  className="border-line-strong hover:bg-muted rounded-lg border px-3 py-1.5 text-sm font-medium whitespace-nowrap"
                >
                  {t("signOut")}
                </button>
              </form>
            </div>
          </div>
          <EmployerNav newThreads={newThreads} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
