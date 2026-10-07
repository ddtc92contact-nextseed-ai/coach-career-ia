// Le vrai layout racine (`<html lang>`) est `[locale]/layout.tsx`. Celui-ci
// n'existe que pour la page 404 hors langue (`not-found.tsx`).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
