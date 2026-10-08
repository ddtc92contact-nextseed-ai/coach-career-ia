import type { SVGProps } from "react";

/**
 * Icônes de la charte (docs/brand.md) : trait de 1,75 sur une grille de 24,
 * extrémités arrondies, couleur héritée du texte. Toujours décoratives
 * (`aria-hidden`) : le sens est porté par le texte voisin.
 */
const PATHS = {
  memory: "M12 3 3 7.5l9 4.5 9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5",
  shield: "M12 3 19.5 6v5.5c0 4.5-3.2 8.3-7.5 9.5-4.3-1.2-7.5-5-7.5-9.5V6L12 3ZM9 12l2 2 4-4",
  radar: "M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l6.5-6.5M12 12h.01",
  send: "M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM12 15v2",
  card: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM14 10h4M14 14h3M6.5 16c.5-1.3 1.4-2 2.5-2s2 .7 2.5 2M9 12a1.75 1.75 0 1 0 0-3.5A1.75 1.75 0 0 0 9 12Z",
  server:
    "M5.5 4h13A1.5 1.5 0 0 1 20 5.5v4a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 9.5v-4A1.5 1.5 0 0 1 5.5 4ZM5.5 13h13a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-4A1.5 1.5 0 0 1 5.5 13ZM8 7.5h.01M8 16.5h.01",
  spark:
    "M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7ZM19 16v4M17 18h4",
  approve: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.5 12l2.5 2.5 4.5-5",
  check: "m5 12.5 4.5 4.5L19 7.5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chevron: "m6 9 6 6 6-6",
  building:
    "M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4",
  chat: "M4 5h16v11H9l-5 4V5ZM8 9.5h8M8 12.5h5",
  // Navigation de l'application (menu latéral).
  dashboard:
    "M5 4h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM15 4h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM15 12h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1ZM5 16h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5c.9-3.5 3.8-5.5 7.5-5.5s6.6 2 7.5 5.5",
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 12h.01",
  wallet: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM3 10h18M7 15h3",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  flag: "M5 21V4M5 4h12l-2.5 4.5L17 13H5",
  flask:
    "M9 3h6M10 3v6.5L4.8 18.2A1.9 1.9 0 0 0 6.4 21h11.2a1.9 1.9 0 0 0 1.6-2.8L14 9.5V3M7 15h10",
  briefcase:
    "M4 7.5h16a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1ZM9 7.5v-2A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2M3 13h18",
  plus: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8v8M8 12h8",
  // Coque de l'application.
  menu: "M4 6.5h16M4 12h16M4 17.5h16",
  close: "M6 6l12 12M18 6 6 18",
  panelClose:
    "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9.5 4v16M16 9.5 13.5 12l2.5 2.5",
  panelOpen:
    "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9.5 4v16M13.5 9.5 16 12l-2.5 2.5",
  logout: "M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3M15.5 16l4-4-4-4M19.5 12H9.5",
  unlock:
    "M7 11V8a5 5 0 0 1 9.6-2M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM12 15v2",
  // Écrans « Mon profil » (preuves, garde-fous, carte).
  proof: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 14l2 2 4-4",
  euro: "M17 5.5a7.5 7.5 0 1 0 0 13M4.5 10h8M4.5 14h8",
  home: "M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4",
  key: "M15 14a5 5 0 1 0-4.6-3L3 18.5V21h2.5v-2h2v-2h2l1.9-1.9A5 5 0 0 0 15 14ZM16.5 7.5h.01",
  // États et actions des écrans « Mon agent » et « Compte ».
  inbox: "M3 13h5l1.5 2.5h5L16 13h5M5.5 5h13l2.5 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5l2.5-8Z",
  reply: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v4",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM3.5 7l8.5 6 8.5-6",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4",
  alert: "M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5M12 17.5h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.5M12 7.5h.01",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  deny: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9 9l6 6M15 9l-6 6",
  bell: "M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0",
  globe:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.7 5.5 3.7 9s-1.2 6.5-3.7 9c-2.5-2.5-3.7-5.5-3.7-9S9.5 5.5 12 3Z",
  download: "M12 4v11M7 10.5l5 5 5-5M5 20h14",
  trash:
    "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7",
  star: "M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  bookmark: "M6 4h12v17l-6-4-6 4V4Z",
  coins:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15 9.2A3.5 3.5 0 0 0 9 11v2a3.5 3.5 0 0 0 6 1.8M7.5 11h5M7.5 13h5",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "size-5",
  ...props
}: { name: IconName } & Omit<SVGProps<SVGSVGElement>, "children">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
