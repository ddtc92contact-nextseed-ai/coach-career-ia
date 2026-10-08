import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteFooter } from "@/components/site-footer";

export function AuthCard({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(40rem_20rem_at_50%_0%,var(--cc-brand-soft),transparent_70%)]"
      />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="mb-8 flex w-full max-w-md items-center justify-between gap-3">
          <Logo />
          <LocaleSwitcher />
        </div>
        <div className="border-line bg-surface w-full max-w-md rounded-3xl border p-6 shadow-md sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-balance">{title}</h1>
          <div className="mt-4">{children}</div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
