import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Filtre optimiste : sans cookie de session, `/app` renvoie vers la connexion
 * en conservant la page demandée. La vérification qui fait foi reste
 * `requireUser()` côté serveur (session validée en base).
 */
export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const login = new URL("/connexion", request.url);
  login.searchParams.set("callbackUrl", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/app", "/app/:path*"],
};
