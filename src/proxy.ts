import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { PATHNAME_HEADER } from "@/lib/auth/redirect";
import { LOCALES, routing } from "@/i18n/routing";

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];
// Espaces connectés : candidat (`/app`) et entreprise (`/entreprise`, sauf la
// page d'inscription « Je recrute », publique).
const APP_PATH = new RegExp(
  `^/(${LOCALES.join("|")})(/app(?:/.*)?|/entreprise(?!/inscription(?:/|$))(?:/.*)?)$`,
);

const intl = createMiddleware(routing);

/**
 * 1. Langue : `/` et toute URL sans préfixe redirigent vers la meilleure langue
 *    (cookie `NEXT_LOCALE`, puis Accept-Language, puis français).
 * 2. Filtre optimiste : sans cookie de session, `/<langue>/app` (et
 *    `/<langue>/entreprise`, hors inscription) renvoie vers la
 *    connexion en conservant la page demandée. La vérification qui fait foi
 *    reste `requireUser()` côté serveur (session validée en base) ; le chemin
 *    demandé (sans langue) lui est transmis par en-tête pour qu'elle conserve
 *    aussi la destination.
 */
export function proxy(request: NextRequest) {
  const appMatch = APP_PATH.exec(request.nextUrl.pathname);
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (appMatch && !hasSession) {
    const [, locale, path = "/app"] = appMatch;
    const login = new URL(`/${locale}/connexion`, request.url);
    login.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(login);
  }

  // Écrase toute valeur fournie par le client.
  const headers = new Headers(request.headers);
  if (appMatch) headers.set(PATHNAME_HEADER, appMatch[2] ?? "/app");
  else headers.delete(PATHNAME_HEADER);
  return intl(new NextRequest(request, { headers }));
}

export const config = {
  // Tout sauf l'API, les fichiers internes de Next.js et les fichiers statiques.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
