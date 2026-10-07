import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { isAdminEmail } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/session";
import { logout } from "./actions";
import { AppNav } from "./nav";

export const metadata: Metadata = {
  title: { default: "Mon espace", template: "%s · Coach Career IA" },
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <Logo href="/app" />
            <div className="flex min-w-0 items-center gap-3">
              <span className="hidden truncate text-sm text-stone-500 sm:inline" title={user.email}>
                {user.email}
              </span>
              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-stone-100"
                >
                  Se déconnecter
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
