/**
 * Styles de bouton de la charte (docs/brand.md), pour un `<button>` comme
 * pour un lien. Rôles : `primary` (une action principale par écran),
 * `secondary` (alternative), `ghost` (navigation), `signal` (appel à l'action
 * sur fond de nuit), `approve` (le « feu vert » de la personne : accepter une
 * suggestion, approuver un message).
 */
const VARIANTS = {
  primary: "bg-primary text-on-primary shadow-sm hover:bg-primary-hover",
  secondary: "border border-line-strong bg-surface text-ink shadow-xs hover:bg-muted",
  ghost: "border border-transparent text-ink-muted hover:bg-muted hover:text-ink",
  signal: "bg-signal text-night shadow-md hover:brightness-110",
  approve: "bg-brand text-on-brand shadow-sm hover:bg-brand-hover",
} as const;

const SIZES = {
  sm: "px-3 py-2 text-sm",
  md: "px-4 py-2.5 text-sm",
  lg: "px-6 py-3.5 text-base",
} as const;

export function buttonClass(
  variant: keyof typeof VARIANTS = "primary",
  size: keyof typeof SIZES = "md",
): string {
  return `inline-flex items-center justify-center gap-2 rounded-lg text-center font-medium transition-[background-color,filter,translate] duration-150 motion-safe:active:translate-y-px disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]}`;
}
