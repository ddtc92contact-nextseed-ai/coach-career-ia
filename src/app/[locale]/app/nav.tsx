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
import { useVault } from "@/components/vault/vault-provider";
import { VaultStatusBadge } from "@/components/vault/vault-widgets";
import { logout } from "./actions";

type NavEntry = { href: string; key: string; icon: IconName; match?: NavMatch };

/** Menu de l'espace candidat, par section (`app.nav.groups.*`). */
export const APP_NAV = [
  {
    group: "profile",
    items: [
      { href: "/app", key: "dashboard", icon: "dashboard", match: { exact: true } },
      { href: "/app/memoire", key: "memory", icon: "memory" },
      { href: "/app/identite", key: "identity", icon: "user" },
      { href: "/app/garde-fous", key: "guardRails", icon: "shield" },
      { href: "/app/carte", key: "card", icon: "card" },
    ],
  },
  {
    group: "agent",
    items: [
      { href: "/app/coach", key: "coach", icon: "spark" },
      { href: "/app/opportunites", key: "opportunities", icon: "target" },
      { href: "/app/contacts", key: "contacts", icon: "chat" },
    ],
  },
  {
    group: "account",
    items: [
      { href: "/app/billing", key: "billing", icon: "wallet" },
      { href: "/app/parametres", key: "settings", icon: "sliders" },
    ],
  },
] as const satisfies readonly { group: string; items: readonly NavEntry[] }[];

/** Section visible des seuls administrateurs. */
export const ADMIN_NAV = {
  group: "admin",
  items: [
    { href: "/app/moderation", key: "moderation", icon: "flag" },
    { href: "/app/radar", key: "radar", icon: "radar" },
    { href: "/app/simulateur-paiement", key: "billingSimulator", icon: "flask" },
  ],
} as const satisfies { group: string; items: readonly NavEntry[] };

/** `unread` : réponses d'entreprises (contacts et négociations) non lues (pastille). */
export function AppNav({ isAdmin = false, unread = 0 }: { isAdmin?: boolean; unread?: number }) {
  const t = useTranslations("app.nav");
  const sections = isAdmin ? [...APP_NAV, ADMIN_NAV] : APP_NAV;
  return (
    <SidebarNav
      label={t("label")}
      groups={sections.map((section) => ({
        id: section.group,
        label: t(`groups.${section.group}`),
        items: section.items.map((item: NavEntry) => ({
          href: item.href,
          label: t(item.key as Parameters<typeof t>[0]),
          icon: item.icon,
          match: item.match,
          badge:
            item.key === "contacts" && unread > 0
              ? { count: unread, label: t("unread", { count: unread }) }
              : undefined,
        })),
      }))}
    />
  );
}

/** Bas du menu : coffre, espace entreprise (membres), langue, compte et déconnexion. */
export function AppSidebarFooter({ email, isMember }: { email: string; isMember: boolean }) {
  const t = useTranslations("app");
  const { lock } = useVault();
  return (
    <>
      <VaultStatusBadge />
      {isMember ? (
        <SidebarFooterLink href="/entreprise" icon="building" label={t("nav.employer")} />
      ) : null}
      <SidebarExpandedOnly>
        <LocaleSwitcher persist tone="night" />
      </SidebarExpandedOnly>
      <SidebarAccount
        email={email}
        signOutAction={logout}
        signOutLabel={t("signOut")}
        onSignOut={lock}
      />
    </>
  );
}
