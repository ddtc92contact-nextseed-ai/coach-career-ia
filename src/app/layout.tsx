import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Coach Career IA — votre agent de carrière privé",
    template: "%s · Coach Career IA",
  },
  description:
    "Votre agent de carrière privé : vos preuves, vos garde-fous, et seulement les opportunités qui les respectent. Anonyme par défaut.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafaf9",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
