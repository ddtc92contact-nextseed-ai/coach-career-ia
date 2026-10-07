"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export const EMPLOYER_NAV = [
  { href: "/entreprise", key: "dashboard" },
  { href: "/entreprise/offres/nouvelle", key: "newPosting" },
  { href: "/entreprise/organisation", key: "organization" },
] as const;

export function EmployerNav() {
  const t = useTranslations("employer.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="-mb-px flex gap-1 overflow-x-auto">
      {EMPLOYER_NAV.map((item) => {
        const active =
          item.href === "/entreprise"
            ? pathname === "/entreprise" ||
              (pathname.startsWith("/entreprise/offres/") &&
                !pathname.startsWith("/entreprise/offres/nouvelle"))
            : pathname.startsWith(item.href);
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
