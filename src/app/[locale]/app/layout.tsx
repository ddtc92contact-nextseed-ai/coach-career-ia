import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { isAdminEmail } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/session";
import { initUserLocale } from "@/lib/career/repository";
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
  const [t, locale] = await Promise.all([getTranslations("app"), getLocale()]);
  // Première visite : la langue de navigation devient la préférence du compte.
  await initUserLocale(user.id, locale);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-3">
            <Logo href="/app" />
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <span className="hidden truncate text-sm text-stone-500 md:inline" title={user.email}>
                {user.email}
              </span>
              <LocaleSwitcher persist />
              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium whitespace-nowrap hover:bg-stone-100"
                >
                  {t("signOut")}
                </button>
              </form>
            </div>
          </div>
          <AppNav isAdmin={isAdminEmail(user.email)} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
