import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? new URL(value).pathname + new URL(value).search : null;
};

describe("proxy : langue", () => {
  it("redirige / vers le français par défaut", () => {
    expect(location(proxy(request("/")))).toBe("/fr");
  });

  it("redirige / vers la langue du navigateur", () => {
    expect(location(proxy(request("/", { "accept-language": "de-DE,de;q=0.9,en;q=0.8" })))).toBe(
      "/de",
    );
    expect(location(proxy(request("/", { "accept-language": "pt-BR" })))).toBe("/fr");
  });

  it("donne la priorité au cookie de langue", () => {
    const response = proxy(
      request("/connexion", { "accept-language": "en", cookie: "NEXT_LOCALE=it" }),
    );
    expect(location(response)).toBe("/it/connexion");
  });

  it("sert une URL préfixée et annonce les alternatives hreflang", () => {
    const response = proxy(request("/nl"));
    expect(response.headers.get("location")).toBeNull();
    const link = response.headers.get("link") ?? "";
    for (const locale of ["fr", "en", "es", "it", "de", "nl"]) {
      expect(link).toContain(`hreflang="${locale}"`);
    }
    expect(link).toContain('hreflang="x-default"');
  });
});

describe("proxy : espace connecté", () => {
  it("renvoie vers la connexion dans la langue courante, en gardant la destination", () => {
    expect(location(proxy(request("/en/app/memoire")))).toBe(
      "/en/connexion?callbackUrl=%2Fapp%2Fmemoire",
    );
  });

  it("laisse passer une session et transmet le chemin demandé sans langue", () => {
    const response = proxy(
      request("/es/app/garde-fous", {
        cookie: "authjs.session-token=abc",
        "x-ccia-pathname": "https://malveillant.example",
      }),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-ccia-pathname")).toBe("/app/garde-fous");
  });

  it("ignore un en-tête de chemin fourni par le client hors de l'espace connecté", () => {
    const response = proxy(request("/fr", { "x-ccia-pathname": "/app/piege" }));
    expect(response.headers.get("x-middleware-request-x-ccia-pathname")).toBeNull();
  });
});
