import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/badge";
import { Icon } from "@/components/icons";
import { AppShell } from "@/components/shell/app-shell";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "@/components/shell/nav";
import { SiteFooter } from "@/components/site-footer";
import { initUserLocale } from "@/lib/career/repository";
import { countNewThreads } from "@/lib/employer/inbox";
import { requireEmployer } from "@/lib/employer/session";
import { EmployerNav, EmployerSidebarFooter } from "./nav";

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
  const [t, locale, newThreads, cookieStore] = await Promise.all([
    getTranslations("employer"),
    getLocale(),
    countNewThreads(org.id),
    cookies(),
  ]);
  await initUserLocale(user.id, locale);

  return (
    <AppShell
      homeHref="/entreprise"
      initialCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === SIDEBAR_COLLAPSED}
      context={
        <div className="bg-night-raised/70 ring-night-line flex items-start gap-3 rounded-xl px-3 py-3 ring-1 ring-inset">
          <Icon name="building" className="text-signal mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-on-night-muted text-xs font-semibold tracking-widest uppercase">
              {t("nav.label")}
            </p>
            <p className="text-on-night mt-0.5 font-semibold break-words">{org.name}</p>
            {org.status !== "ACTIVE" ? (
              <p className="mt-2">
                <Badge tone="warning">{t(`org.status.${org.status}`)}</Badge>
              </p>
            ) : null}
          </div>
        </div>
      }
      nav={<EmployerNav newThreads={newThreads} />}
      footer={<EmployerSidebarFooter email={user.email} />}
      pageFooter={<SiteFooter />}
    >
      {children}
    </AppShell>
  );
}
