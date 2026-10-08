import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteFooter } from "@/components/site-footer";
import { VaultProvider } from "@/components/vault/vault-provider";
import { LogoutButton, VaultStatusBadge } from "@/components/vault/vault-widgets";
import { isAdminEmail } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/session";
import { initUserLocale } from "@/lib/career/repository";
import { getMembership } from "@/lib/employer/repository";
import { Link } from "@/i18n/navigation";
import { logout } from "./actions";
import { AppNav } from "./nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: t("metaTitle"), template: t("titleTemplate") },
    robots: { index: false, follow: false },
  };
}

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const [t, locale, membership] = await Promise.all([
    getTranslations("app"),
    getLocale(),
    getMembership(user.id),
  ]);
  // Première visite : la langue de navigation devient la préférence du compte.
  await initUserLocale(user.id, locale);

  return (
    <VaultProvider>
      <div className="flex min-h-dvh flex-col">
        <header className="border-line bg-surface border-b">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex h-16 items-center justify-between gap-3">
              <Logo href="/app" />
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <span
                  className="text-ink-subtle hidden truncate text-sm md:inline"
                  title={user.email}
                >
                  {user.email}
                </span>
                {membership ? (
                  <Link
                    href="/entreprise"
                    className="text-ink-muted hover:text-ink hidden text-sm hover:underline md:inline"
                  >
                    {t("nav.employer")}
                  </Link>
                ) : null}
                <VaultStatusBadge />
                <LocaleSwitcher persist />
                <LogoutButton action={logout} label={t("signOut")} />
              </div>
            </div>
            <AppNav isAdmin={isAdminEmail(user.email)} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <SiteFooter />
      </div>
    </VaultProvider>
  );
}
