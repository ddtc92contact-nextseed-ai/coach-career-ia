import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "@/lib/auth/redirect";

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Filtre optimiste : sans cookie de session, `/app` renvoie vers la connexion
 * en conservant la page demandée. La vérification qui fait foi reste
 * `requireUser()` côté serveur (session validée en base) ; le chemin demandé
 * lui est transmis par en-tête pour qu'elle conserve aussi la destination.
 */
export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) {
    // Écrase toute valeur fournie par le client.
    const headers = new Headers(request.headers);
    headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.redirect(loginUrl(request.url, request.nextUrl.pathname));
}

function loginUrl(base: string, pathname: string): URL {
  const login = new URL("/connexion", base);
  login.searchParams.set("callbackUrl", pathname);
  return login;
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
