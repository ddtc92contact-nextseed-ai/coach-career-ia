import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { routing } from "@/i18n/routing";
import { localeAlternates, siteUrl } from "@/lib/i18n/metadata";
import "../globals.css";

// Polices de la charte (docs/brand.md), auto-hébergées par next/font : aucune
// requête vers un service tiers au chargement des pages.
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });
const bricolage = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-bricolage",
  display: "swap",
});

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    metadataBase: siteUrl(),
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    alternates: localeAlternates(locale, "/"),
    openGraph: { locale, siteName: t("siteName") },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Mêmes valeurs que --cc-canvas (globals.css), clair puis sombre.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "oklch(0.985 0.005 85)" },
    { media: "(prefers-color-scheme: dark)", color: "oklch(0.165 0.022 275)" },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: Readonly<Props & { children: React.ReactNode }>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html lang={locale} className={`${inter.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh font-sans">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
