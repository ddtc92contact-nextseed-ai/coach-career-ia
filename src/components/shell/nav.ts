import type { IconName } from "@/components/icons";

/**
 * Cookie qui mémorise le menu latéral réduit (bureau). Préférence d'affichage,
 * strictement nécessaire : lue par les layouts pour rendre le bon état dès le
 * serveur, sans clignotement.
 */
export const SIDEBAR_COOKIE = "cc-sidebar";
export const SIDEBAR_COLLAPSED = "collapsed";

/** Cookie à écrire côté navigateur (un an, tout le site). */
export function sidebarCookie(collapsed: boolean, secure: boolean): string {
  const value = collapsed ? SIDEBAR_COLLAPSED : "expanded";
  return `${SIDEBAR_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax${secure ? "; secure" : ""}`;
}

/**
 * Règle d'état actif d'une entrée : la page elle-même et ses sous-pages, ou
 * la page seule (`exact`) ; `also` ajoute d'autres rubriques, `except` en
 * retire (appliqué en premier).
 */
export type NavMatch = {
  exact?: boolean;
  also?: readonly string[];
  except?: readonly string[];
};

export type SidebarItem = {
  href: string;
  label: string;
  icon: IconName;
  match?: NavMatch;
  /** Pastille de nouveautés (ex. réponses non lues), avec son libellé lu par les lecteurs d'écran. */
  badge?: { count: number; label: string };
};

export type SidebarGroup = { id: string; label: string; items: SidebarItem[] };

/** `pathname` est sans préfixe de langue (`usePathname` de `@/i18n/navigation`). */
export function isNavActive(pathname: string, href: string, match: NavMatch = {}): boolean {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (match.except?.some(under)) return false;
  if (match.exact ? pathname === href : under(href)) return true;
  return match.also?.some(under) ?? false;
}
