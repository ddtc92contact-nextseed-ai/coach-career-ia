import Link from "next/link";
import "./globals.css";

// Page 404 hors préfixe de langue (cas rare : le proxy redirige presque tout
// vers une langue). Sans contexte de langue, elle reste en français.
export default function GlobalNotFound() {
  return (
    <html lang="fr">
      <body className="grid min-h-dvh place-items-center px-4 font-sans">
        <main className="text-center">
          <h1 className="text-xl font-semibold">Page introuvable</h1>
          <Link href="/" className="text-brand-ink mt-4 inline-block underline underline-offset-4">
            Coach Career IA
          </Link>
        </main>
      </body>
    </html>
  );
}
