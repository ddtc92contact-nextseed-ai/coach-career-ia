"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export const APP_NAV = [
  { href: "/app", key: "dashboard" },
  { href: "/app/memoire", key: "memory" },
  { href: "/app/garde-fous", key: "guardRails" },
  { href: "/app/opportunites", key: "opportunities" },
  { href: "/app/parametres", key: "settings" },
] as const;

export function AppNav() {
  const t = useTranslations("app.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="-mb-px flex gap-1 overflow-x-auto">
      {APP_NAV.map((item) => {
        const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap ${
              active
                ? "border-stone-900 text-stone-900"
                : "border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800"
            }`}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
