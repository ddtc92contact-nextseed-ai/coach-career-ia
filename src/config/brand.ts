/**
 * Couleurs de la charte en sRGB, pour les seuls supports qui ne lisent pas
 * les variables CSS (image Open Graph). Équivalents exacts des jetons oklch de
 * `src/app/globals.css` (docs/brand.md) : les modifier ensemble.
 */
export const BRAND_HEX = {
  night: "#10142a", // --cc-night
  nightLine: "#353b57", // --cc-night-line
  onNight: "#f7f5f1", // --cc-on-night
  onNightMuted: "#babdcb", // --cc-on-night-muted
  signal: "#66f597", // --cc-signal
} as const;
