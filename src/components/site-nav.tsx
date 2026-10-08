"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/icons";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { BrandMark } from "@/components/logo";
import { SIGN_UP_PATH } from "@/config/routes";
import { Link } from "@/i18n/navigation";

export type SectionLink = { href: `#${string}`; label: string };

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), input, [tabindex="0"]';
const DESKTOP_QUERY = "(min-width: 64rem)";

/**
 * Section de la page en cours de lecture : la dernière section (`main
 * section[id]`) dont le haut a passé le premier tiers de l'écran. `null`
 * au-dessus de la première (hero).
 */
export function useActiveSection(enabled: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.35;
      let current: string | null = null;
      for (const section of document.querySelectorAll<HTMLElement>("main section[id]")) {
        if (section.getBoundingClientRect().top <= line) current = section.id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [enabled]);
  return active;
}

/** Ancres de l'accueil, visibles dès 1024 px ; la section lue est mise en avant. */
export function SectionNav({ sections, label }: { sections: SectionLink[]; label: string }) {
  const active = useActiveSection(true);
  return (
    <nav aria-label={label} className="hidden min-w-0 lg:block">
      <ul className="flex items-center gap-0.5 xl:gap-1">
        {sections.map((section) => {
          const current = active === section.href.slice(1);
          return (
            <li key={section.href}>
              <a
                href={section.href}
                aria-current={current ? "true" : undefined}
                className={`relative flex items-center rounded-full px-2.5 py-2 text-[0.9375rem] font-semibold whitespace-nowrap motion-safe:transition-colors xl:px-4 xl:text-base ${
                  current
                    ? "bg-brand-soft text-brand-ink ring-brand-line ring-1 ring-inset"
                    : "text-ink-muted hover:bg-muted hover:text-ink"
                }`}
              >
                {section.label}
                {current ? (
                  <span
                    aria-hidden="true"
                    className="bg-brand absolute bottom-1 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full"
                  />
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Menu des pages publiques sur téléphone et tablette (< 1024 px) : bouton
 * « menu » puis panneau plein écran « nuit » (`role="dialog"`) — focus piégé,
 * Échap, fermeture au clic sur un lien, défilement bloqué, reste de la page
 * `inert`.
 */
export function SiteMenu({ sections }: { sections?: SectionLink[] }) {
  const t = useTranslations("shell");
  const th = useTranslations("header");
  const tm = useTranslations("metadata");
  const [open, setOpen] = useState(false);
  const active = useActiveSection(Boolean(sections?.length));
  const panelRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  function close(restore: boolean) {
    restoreFocus.current = restore;
    setOpen(false);
  }

  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) burgerRef.current?.focus();
      restoreFocus.current = false;
      return;
    }
    const panel = panelRef.current;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Le panneau est rendu directement dans <body> : tout le reste devient inerte.
    const others = [...document.body.children].filter(
      (el): el is HTMLElement => el !== panel && el instanceof HTMLElement && !el.inert,
    );
    for (const el of others) el.inert = true;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getClientRects().length > 0,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const inside = panel.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }
    const desktop = window.matchMedia(DESKTOP_QUERY);
    function onDesktop() {
      if (desktop.matches) close(false);
    }
    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      for (const el of others) el.inert = false;
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onDesktop);
    };
  }, [open]);

  // Ancre de la page : on ferme d'abord (défilement débloqué), puis on y va.
  function onSectionClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    close(false);
    requestAnimationFrame(() => {
      if (window.location.hash === href) document.querySelector(href)?.scrollIntoView();
      else window.location.hash = href;
    });
  }

  // Lien vers une autre page : le panneau se ferme avec la navigation.
  function onPanelClick(event: MouseEvent<HTMLElement>) {
    const link = (event.target as Element).closest("a[href]");
    if (link && !link.getAttribute("href")?.startsWith("#")) close(false);
  }

  return (
    <>
      <button
        ref={burgerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="text-ink hover:bg-muted -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-xl lg:hidden"
      >
        <Icon name="menu" className="size-6" />
        <span className="sr-only">{t("openMenu")}</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("menu")}
              onClick={onPanelClick}
              className="band-night on-night text-on-night fixed inset-0 z-50 flex flex-col overflow-y-auto lg:hidden"
            >
              <div className="flex h-[4.5rem] shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
                <Link
                  href="/"
                  className="font-display flex items-center gap-2.5 rounded-lg text-[1.0625rem] font-bold tracking-tight"
                >
                  <BrandMark className="ring-night-line size-8 rounded-[0.55rem] ring-1" />
                  {tm("siteName")}
                </Link>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => close(true)}
                  className="text-on-night-muted hover:bg-night-raised hover:text-on-night -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-xl"
                >
                  <Icon name="close" className="size-6" />
                  <span className="sr-only">{t("closeMenu")}</span>
                </button>
              </div>
              <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 pb-10 sm:px-6">
                {sections?.length ? (
                  <nav aria-label={th("sections")}>
                    <ul className="divide-night-line border-night-line divide-y border-y">
                      {sections.map((section) => {
                        const current = active === section.href.slice(1);
                        return (
                          <li key={section.href}>
                            <a
                              href={section.href}
                              aria-current={current ? "true" : undefined}
                              onClick={(event) => onSectionClick(event, section.href)}
                              className={`font-display flex items-center justify-between gap-4 py-4 text-2xl font-bold tracking-tight sm:text-3xl ${
                                current ? "text-signal" : "hover:text-signal"
                              }`}
                            >
                              {section.label}
                              <Icon
                                name="arrow"
                                className={`size-5 shrink-0 ${current ? "" : "text-on-night-muted"}`}
                              />
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </nav>
                ) : null}
                <div className="mt-8 flex flex-col gap-3">
                  <Link href={SIGN_UP_PATH} className={`${buttonClass("signal", "lg")} w-full`}>
                    {th("createAgent")}
                    <Icon name="arrow" className="size-4" />
                  </Link>
                  <Link
                    href="/connexion"
                    className="border-night-line hover:bg-night-raised inline-flex w-full items-center justify-center rounded-lg border px-6 py-3.5 text-base font-medium motion-safe:transition-colors"
                  >
                    {th("signIn")}
                  </Link>
                  <Link
                    href="/entreprise/inscription"
                    className="text-on-night-muted hover:text-on-night mt-2 flex items-center justify-center gap-2 rounded-lg py-2 text-base font-medium"
                  >
                    <Icon name="building" className="size-5" />
                    {th("recruiter")}
                  </Link>
                </div>
                <div className="mt-auto pt-10">
                  <LocaleSwitcher tone="night" />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
