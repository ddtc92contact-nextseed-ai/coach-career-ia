import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { AppShell } from "@/components/shell/app-shell";
import { SIDEBAR_COLLAPSED, SIDEBAR_COOKIE } from "@/components/shell/nav";
import { SiteFooter } from "@/components/site-footer";
import { VaultProvider } from "@/components/vault/vault-provider";
import { isAdminEmail } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/session";
import { initUserLocale } from "@/lib/career/repository";
import { unreadReplies } from "@/lib/contact/repository";
import { getMembership } from "@/lib/employer/repository";
import { AppNav, AppSidebarFooter } from "./nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("metaTitle"), template: t("titleTemplate") },
    robots: { index: false, follow: false },
  };
}

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const [locale, membership, unread, cookieStore] = await Promise.all([
    getLocale(),
    getMembership(user.id),
    unreadReplies(user.id),
    cookies(),
  ]);
  // Première visite : la langue de navigation devient la préférence du compte.
  await initUserLocale(user.id, locale);

  return (
    <VaultProvider>
      <AppShell
        homeHref="/app"
        initialCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === SIDEBAR_COLLAPSED}
        nav={<AppNav isAdmin={isAdminEmail(user.email)} unread={unread} />}
        footer={<AppSidebarFooter email={user.email} isMember={Boolean(membership)} />}
        pageFooter={<SiteFooter />}
      >
        {children}
      </AppShell>
    </VaultProvider>
  );
}
