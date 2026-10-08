"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export const EMPLOYER_NAV = [
  { href: "/entreprise", key: "dashboard" },
  { href: "/entreprise/messages", key: "messages" },
  { href: "/entreprise/offres/nouvelle", key: "newPosting" },
  { href: "/entreprise/organisation", key: "organization" },
] as const;

/** `newThreads` : fils de la messagerie jamais ouverts (pastille). */
export function EmployerNav({ newThreads = 0 }: { newThreads?: number }) {
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
                ? "border-brand text-ink"
                : "text-ink-subtle hover:border-line-strong hover:text-ink border-transparent"
            }`}
          >
            {t(item.key)}
            {item.key === "messages" && newThreads > 0 ? (
              <span className="bg-brand text-on-brand ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold">
                <span aria-hidden="true">{newThreads}</span>
                <span className="sr-only">{t("newThreads", { count: newThreads })}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
