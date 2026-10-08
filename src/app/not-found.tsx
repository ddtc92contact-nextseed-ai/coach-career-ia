import Link from "next/link";
import { buttonClass } from "@/components/button";
import { BrandMark } from "@/components/logo";
import "./globals.css";

// Page 404 hors préfixe de langue (cas rare : le proxy redirige presque tout
// vers une langue). Sans contexte de langue, elle reste en français.
export default function GlobalNotFound() {
  return (
    <html lang="fr">
      <body className="grid min-h-dvh place-items-center px-4 font-sans">
        <main className="border-line bg-surface w-full max-w-lg rounded-3xl border p-8 text-center shadow-md sm:p-10">
          <BrandMark className="mx-auto size-12" />
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Page introuvable</h1>
          <p className="text-ink-muted mt-3 text-[1.0625rem]">
            Cette page n’existe pas ou a été déplacée.
          </p>
          <Link href="/" className={`${buttonClass("primary", "lg")} mt-7`}>
            Coach Career IA
          </Link>
        </main>
      </body>
    </html>
  );
}
