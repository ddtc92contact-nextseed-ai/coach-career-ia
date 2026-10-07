import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";

export function AuthCard({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex w-full max-w-md items-center justify-between gap-3">
        <Logo />
        <LocaleSwitcher />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-4">{children}</div>
      </div>
    </main>
  );
}
