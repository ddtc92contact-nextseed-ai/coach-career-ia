"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export const APP_NAV = [
  { href: "/app", key: "dashboard" },
  { href: "/app/memoire", key: "memory" },
  { href: "/app/identite", key: "identity" },
  { href: "/app/garde-fous", key: "guardRails" },
  { href: "/app/coach", key: "coach" },
  { href: "/app/opportunites", key: "opportunities" },
  { href: "/app/carte", key: "card" },
  { href: "/app/contacts", key: "contacts" },
  { href: "/app/billing", key: "billing" },
  { href: "/app/parametres", key: "settings" },
] as const;

/** Entrée visible des seuls administrateurs. */
export const ADMIN_NAV = [{ href: "/app/radar", key: "radar" }] as const;

export function AppNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const t = useTranslations("app.nav");
  const pathname = usePathname();
  const items = isAdmin ? [...APP_NAV, ...ADMIN_NAV] : APP_NAV;
  return (
    <nav aria-label={t("label")} className="-mb-px flex gap-1 overflow-x-auto">
      {items.map((item) => {
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
