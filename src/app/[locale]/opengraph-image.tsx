import { ImageResponse } from "next/og";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { BRAND_HEX as C } from "@/config/brand";
import { DEFAULT_LOCALE, routing } from "@/i18n/routing";

export const alt = "Coach Career IA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Image de partage (Open Graph) de chaque langue, générée sans ressource externe. */
export default async function OpengraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = hasLocale(routing.locales, raw) ? raw : DEFAULT_LOCALE;
  const [t, tm] = await Promise.all([
    getTranslations({ locale, namespace: "landing.hero" }),
    getTranslations({ locale, namespace: "metadata" }),
  ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: `radial-gradient(circle at 85% 110%, ${C.nightLine} 0%, ${C.night} 55%)`,
        color: C.onNight,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <svg width="72" height="72" viewBox="0 0 32 32">
          <rect
            x="0.5"
            y="0.5"
            width="31"
            height="31"
            rx="8.5"
            fill={C.night}
            stroke={C.nightLine}
          />
          <path d="M15 7a9 9 0 0 0 0 18 11 11 0 0 1 0-18Z" fill={C.onNight} />
          <circle cx="21.5" cy="16" r="3.25" fill={C.signal} />
        </svg>
        <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{tm("siteName")}</span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 64,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: -2,
        }}
      >
        {t.markup("title", { signal: (chunks) => chunks })}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontSize: 28,
          color: C.onNightMuted,
        }}
      >
        <div style={{ width: 16, height: 16, borderRadius: 16, background: C.signal }} />
        {t("eyebrow")}
      </div>
    </div>,
    size,
  );
}
