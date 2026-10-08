import { describe, expect, it } from "vitest";
import { isNavActive, sidebarCookie } from "@/components/shell/nav";

describe("isNavActive (menu latéral)", () => {
  it("une entrée couvre sa page et ses sous-pages, pas un simple préfixe de nom", () => {
    expect(isNavActive("/app/memoire", "/app/memoire")).toBe(true);
    expect(isNavActive("/app/memoire/realisations/nouvelle", "/app/memoire")).toBe(true);
    expect(isNavActive("/app/memoires", "/app/memoire")).toBe(false);
  });

  it("`exact` : le tableau de bord n'est actif que sur sa propre page", () => {
    expect(isNavActive("/app", "/app", { exact: true })).toBe(true);
    expect(isNavActive("/app/coach", "/app", { exact: true })).toBe(false);
  });

  it("« Mes offres » couvre les fiches d'offre et le paiement, pas la publication", () => {
    const match = {
      exact: true,
      also: ["/entreprise/offres", "/entreprise/paiement"],
      except: ["/entreprise/offres/nouvelle"],
    };
    expect(isNavActive("/entreprise", "/entreprise", match)).toBe(true);
    expect(isNavActive("/entreprise/offres/abc", "/entreprise", match)).toBe(true);
    expect(isNavActive("/entreprise/paiement", "/entreprise", match)).toBe(true);
    expect(isNavActive("/entreprise/offres/nouvelle", "/entreprise", match)).toBe(false);
    expect(isNavActive("/entreprise/messages", "/entreprise", match)).toBe(false);
  });
});

describe("sidebarCookie", () => {
  it("mémorise l'état du menu pour tout le site, un an, `secure` en HTTPS", () => {
    expect(sidebarCookie(true, false)).toBe(
      "cc-sidebar=collapsed; path=/; max-age=31536000; samesite=lax",
    );
    expect(sidebarCookie(false, true)).toBe(
      "cc-sidebar=expanded; path=/; max-age=31536000; samesite=lax; secure",
    );
  });
});
