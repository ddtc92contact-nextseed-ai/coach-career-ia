"use client";

import { useTranslations } from "next-intl";
import type { IconName } from "@/components/icons";
import { LocaleSwitcher } from "@/components/locale-switcher";
import {
  SidebarAccount,
  SidebarExpandedOnly,
  SidebarFooterLink,
  SidebarNav,
} from "@/components/shell/app-shell";
import type { NavMatch } from "@/components/shell/nav";
import { logout } from "../../app/actions";

type NavEntry = { href: string; key: string; icon: IconName; match?: NavMatch };

/** Menu de l'espace entreprise, par section (`employer.nav.groups.*`). */
export const EMPLOYER_NAV = [
  {
    group: "hiring",
    items: [
      {
        href: "/entreprise",
        key: "dashboard",
        icon: "briefcase",
        // Fiche d'une offre et paiement : rattachés à « Mes offres ».
        match: {
          exact: true,
          also: ["/entreprise/offres", "/entreprise/paiement"],
          except: ["/entreprise/offres/nouvelle"],
        },
      },
      { href: "/entreprise/offres/nouvelle", key: "newPosting", icon: "plus" },
      { href: "/entreprise/messages", key: "messages", icon: "chat" },
    ],
  },
  {
    group: "account",
    items: [{ href: "/entreprise/organisation", key: "organization", icon: "building" }],
  },
] as const satisfies readonly { group: string; items: readonly NavEntry[] }[];

/** `newThreads` : fils de la messagerie jamais ouverts (pastille). */
export function EmployerNav({ newThreads = 0 }: { newThreads?: number }) {
  const t = useTranslations("employer.nav");
  return (
    <SidebarNav
      label={t("label")}
      groups={EMPLOYER_NAV.map((section) => ({
        id: section.group,
        label: t(`groups.${section.group}`),
        items: section.items.map((item: NavEntry) => ({
          href: item.href,
          label: t(item.key as Parameters<typeof t>[0]),
          icon: item.icon,
          match: item.match,
          badge:
            item.key === "messages" && newThreads > 0
              ? { count: newThreads, label: t("newThreads", { count: newThreads }) }
              : undefined,
        })),
      }))}
    />
  );
}

/** Bas du menu : espace candidat, langue, compte et déconnexion. */
export function EmployerSidebarFooter({ email }: { email: string }) {
  const t = useTranslations("employer");
  return (
    <>
      <SidebarFooterLink href="/app" icon="user" label={t("nav.candidate")} />
      <SidebarExpandedOnly>
        <LocaleSwitcher persist tone="night" />
      </SidebarExpandedOnly>
      <SidebarAccount email={email} signOutAction={logout} signOutLabel={t("signOut")} />
    </>
  );
}
