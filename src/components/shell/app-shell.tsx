"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@/components/icons";
import { BrandMark } from "@/components/logo";
import { Link, usePathname } from "@/i18n/navigation";
import { isNavActive, sidebarCookie, type SidebarGroup } from "./nav";

const ShellContext = createContext({ collapsed: false });

/** Menu réduit en rail d'icônes (bureau uniquement : le tiroir mobile est toujours déplié). */
export function useShell() {
  return useContext(ShellContext);
}

/** Masqué visuellement en mode rail, toujours lu par les lecteurs d'écran. */
function railHidden(collapsed: boolean) {
  return collapsed ? "lg:sr-only" : "";
}

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), input, [tabindex="0"]';
const DESKTOP_QUERY = "(min-width: 64rem)";

/**
 * Coque de l'espace candidat et de l'espace entreprise (docs/brand.md §6) :
 * menu latéral « nuit » à gauche (fixe sur bureau, réductible en rail
 * d'icônes, choix mémorisé dans un cookie) ; sur téléphone et tablette, barre
 * du haut avec un bouton qui ouvre le menu en tiroir accessible (focus piégé,
 * Échap, fermeture à la navigation, défilement de la page bloqué).
 */
export function AppShell({
  homeHref,
  initialCollapsed = false,
  context,
  nav,
  footer,
  pageFooter,
  children,
}: {
  homeHref: string;
  initialCollapsed?: boolean;
  /** Bloc sous le logo (ex. nom de l'organisation et son statut). */
  context?: ReactNode;
  nav: ReactNode;
  /** Bas du menu : compte, langue, déconnexion… */
  footer: ReactNode;
  /** Pied de page du site, sous le contenu. */
  pageFooter?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const sidebarId = useId();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  // Le tiroir est ouvert « pour la page où on l'a ouvert » : il se referme
  // donc de lui-même dès que la navigation change de page.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const open = drawerPath === pathname;
  const sidebarRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  function closeDrawer() {
    restoreFocus.current = true;
    setDrawerPath(null);
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      document.cookie = sidebarCookie(next, window.location.protocol === "https:");
    } catch {
      // Cookies indisponibles : le choix vaut pour la page en cours.
    }
  }

  // Un lien du tiroir referme le tiroir, même s'il mène à la page en cours.
  function onSidebarClick(event: MouseEvent<HTMLElement>) {
    if (open && (event.target as Element).closest("a[href]")) setDrawerPath(null);
  }

  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) burgerRef.current?.focus();
      restoreFocus.current = false;
      return;
    }
    const sidebar = sidebarRef.current;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        restoreFocus.current = true;
        setDrawerPath(null);
        return;
      }
      if (event.key !== "Tab" || !sidebar) return;
      const focusable = [...sidebar.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getClientRects().length > 0,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const inside = sidebar.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }
    // Passage en largeur bureau : le menu redevient la colonne fixe.
    const desktop = window.matchMedia(DESKTOP_QUERY);
    function onDesktop() {
      if (desktop.matches) setDrawerPath(null);
    }
    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onDesktop);
    };
  }, [open]);

  const iconButton =
    "size-11 shrink-0 items-center justify-center rounded-xl text-on-night-muted hover:bg-night-raised hover:text-on-night motion-safe:transition-colors";

  return (
    <ShellContext.Provider value={{ collapsed }}>
      <div className="type-app min-h-dvh lg:flex">
        <a
          href="#contenu"
          className="bg-surface text-ink sr-only rounded-lg px-4 py-2 font-medium shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]"
        >
          {t("skipToContent")}
        </a>

        <header
          inert={open}
          className="sidebar-night on-night text-on-night sticky top-0 z-30 flex h-16 items-center justify-between gap-3 px-4 shadow-md sm:px-6 lg:hidden"
        >
          <ShellLogo href={homeHref} />
          <button
            ref={burgerRef}
            type="button"
            aria-expanded={open}
            aria-controls={sidebarId}
            onClick={() => setDrawerPath(pathname)}
            className={`${iconButton} -mr-2 inline-flex`}
          >
            <Icon name="menu" className="size-6" />
            <span className="sr-only">{t("openMenu")}</span>
          </button>
        </header>

        {open ? (
          <div
            aria-hidden="true"
            onClick={closeDrawer}
            className="bg-night/60 fixed inset-0 z-40 backdrop-blur-[2px] lg:hidden"
          />
        ) : null}

        <aside
          id={sidebarId}
          ref={sidebarRef}
          role={open ? "dialog" : undefined}
          aria-modal={open ? true : undefined}
          aria-label={t("menu")}
          onClick={onSidebarClick}
          className={`sidebar-night on-night text-on-night motion-safe:ease-out-soft fixed inset-y-0 left-0 z-50 flex w-[min(20rem,calc(100vw-3rem))] flex-col motion-safe:duration-300 motion-reduce:transition-none lg:visible lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:shrink-0 lg:translate-x-0 lg:shadow-none ${
            collapsed ? "lg:w-20" : "lg:w-[17rem]"
          } ${
            // À l'ouverture, visible tout de suite (le focus peut y entrer) ; à la
            // fermeture, visible jusqu'à la fin du glissement.
            open
              ? "visible translate-x-0 shadow-lg motion-safe:transition-[translate,width]"
              : "invisible -translate-x-full motion-safe:transition-[translate,visibility,width]"
          }`}
        >
          <div
            className={`flex h-16 shrink-0 items-center justify-between gap-2 px-4 lg:h-20 ${
              collapsed
                ? "lg:h-auto lg:flex-col lg:justify-center lg:px-0 lg:py-4"
                : "lg:pr-3 lg:pl-5"
            }`}
          >
            <ShellLogo href={homeHref} />
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-controls={sidebarId}
              title={collapsed ? t("expand") : t("collapse")}
              className={`${iconButton} hidden lg:inline-flex`}
            >
              <Icon name={collapsed ? "panelOpen" : "panelClose"} className="size-5" />
              <span className="sr-only">{collapsed ? t("expand") : t("collapse")}</span>
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={closeDrawer}
              className={`${iconButton} -mr-2 inline-flex lg:hidden`}
            >
              <Icon name="close" className="size-6" />
              <span className="sr-only">{t("closeMenu")}</span>
            </button>
          </div>
          {context ? (
            <div className={`shrink-0 px-4 pb-3 ${collapsed ? "lg:hidden" : "lg:px-5"}`}>
              {context}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">{nav}</div>
          <div className="border-night-line shrink-0 space-y-2 border-t px-3 py-3">{footer}</div>
        </aside>

        <div inert={open} className="flex min-w-0 flex-1 flex-col">
          <main
            id="contenu"
            tabIndex={-1}
            className="mx-auto w-full max-w-[80rem] flex-1 px-4 py-8 focus:outline-none sm:px-8 lg:px-10 lg:py-10"
          >
            {children}
          </main>
          {pageFooter}
        </div>
      </div>
    </ShellContext.Provider>
  );
}

function ShellLogo({ href }: { href: string }) {
  const t = useTranslations("metadata");
  const { collapsed } = useShell();
  return (
    <Link
      href={href}
      className="font-display flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg text-[1.0625rem] font-bold tracking-tight"
    >
      <BrandMark className="size-9" />
      <span className={`truncate ${railHidden(collapsed)}`}>{t("siteName")}</span>
    </Link>
  );
}

/** Navigation du menu latéral : sections titrées, une icône par entrée. */
export function SidebarNav({ label, groups }: { label: string; groups: SidebarGroup[] }) {
  const pathname = usePathname();
  const { collapsed } = useShell();
  return (
    <nav aria-label={label}>
      {groups.map((group, index) => (
        <div
          key={group.id}
          className={
            index === 0
              ? ""
              : collapsed
                ? "lg:border-night-line mt-6 lg:mt-3 lg:border-t lg:pt-3"
                : "mt-6"
          }
        >
          <p
            id={`${group.id}-nav`}
            className={`text-on-night-muted px-3 pb-2 text-xs font-semibold tracking-widest uppercase ${railHidden(collapsed)}`}
          >
            {group.label}
          </p>
          <ul aria-labelledby={`${group.id}-nav`} className="space-y-1">
            {group.items.map((item) => {
              const active = isNavActive(pathname, item.href, item.match);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`group/link relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] leading-snug font-medium motion-safe:transition-colors ${
                      collapsed ? "lg:justify-center lg:px-0" : ""
                    } ${
                      active
                        ? "bg-night-raised text-on-night ring-night-line before:bg-signal shadow-sm ring-1 ring-inset before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full"
                        : "text-on-night-muted hover:bg-night-raised/70 hover:text-on-night"
                    }`}
                  >
                    <span className="relative shrink-0">
                      <Icon
                        name={item.icon}
                        className={`size-5 ${active ? "text-signal" : "group-hover/link:text-on-night"}`}
                      />
                      {item.badge && collapsed ? (
                        <span
                          aria-hidden="true"
                          className="bg-signal text-night ring-night absolute -top-1.5 -right-2 hidden h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.6875rem] font-bold ring-2 lg:inline-flex"
                        >
                          {item.badge.count}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`min-w-0 flex-1 break-words hyphens-auto ${railHidden(collapsed)}`}
                    >
                      {item.label}
                    </span>
                    {item.badge ? (
                      <>
                        <span
                          aria-hidden="true"
                          className={`bg-signal text-night inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums ${
                            collapsed ? "lg:hidden" : ""
                          }`}
                        >
                          {item.badge.count}
                        </span>
                        <span className="sr-only">{item.badge.label}</span>
                      </>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const footerRow =
  "text-on-night-muted hover:bg-night-raised hover:text-on-night flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium motion-safe:transition-colors";

/** Lien du bas du menu (ex. passage à l'autre espace). */
export function SidebarFooterLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: IconName;
  label: string;
}) {
  const { collapsed } = useShell();
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`${footerRow} ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
    >
      <Icon name={icon} className="size-5 shrink-0" />
      <span className={`min-w-0 break-words hyphens-auto ${railHidden(collapsed)}`}>{label}</span>
    </Link>
  );
}

/**
 * Compte connecté (initiale + e-mail) et bouton de déconnexion. `onSignOut`
 * s'exécute avant l'envoi (ex. effacer la clé du coffre).
 */
export function SidebarAccount({
  email,
  signOutAction,
  signOutLabel,
  onSignOut,
}: {
  email: string;
  signOutAction: () => Promise<void>;
  signOutLabel: string;
  onSignOut?: () => void;
}) {
  const { collapsed } = useShell();
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-1 ${collapsed ? "lg:flex-col lg:gap-2 lg:px-0" : ""}`}
    >
      <span
        aria-hidden="true"
        title={collapsed ? email : undefined}
        className="bg-signal text-night font-display inline-flex size-9 shrink-0 items-center justify-center rounded-full text-base font-bold uppercase"
      >
        {email.charAt(0)}
      </span>
      <span
        className={`text-on-night min-w-0 flex-1 truncate text-sm ${railHidden(collapsed)}`}
        title={email}
      >
        {email}
      </span>
      <form action={signOutAction} onSubmit={onSignOut} className="shrink-0">
        <button
          type="submit"
          title={signOutLabel}
          className="text-on-night-muted hover:bg-night-raised hover:text-on-night inline-flex size-11 items-center justify-center rounded-xl motion-safe:transition-colors"
        >
          <Icon name="logout" className="size-5" />
          <span className="sr-only">{signOutLabel}</span>
        </button>
      </form>
    </div>
  );
}

/** Contenu masqué en mode rail (ex. sélecteur de langue). */
export function SidebarExpandedOnly({ children }: { children: ReactNode }) {
  const { collapsed } = useShell();
  return <div className={collapsed ? "lg:hidden" : ""}>{children}</div>;
}
