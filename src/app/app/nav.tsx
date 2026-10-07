"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const APP_NAV = [
  { href: "/app", label: "Tableau de bord" },
  { href: "/app/memoire", label: "Ma mémoire de carrière" },
  { href: "/app/garde-fous", label: "Mes garde-fous" },
  { href: "/app/opportunites", label: "Opportunités" },
] as const;

/** Entrée visible des seuls administrateurs. */
export const ADMIN_NAV = [{ href: "/app/radar", label: "Radar (admin)" }] as const;

export function AppNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...APP_NAV, ...ADMIN_NAV] : APP_NAV;
  return (
    <nav aria-label="Espace candidat" className="-mb-px flex gap-1 overflow-x-auto">
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
