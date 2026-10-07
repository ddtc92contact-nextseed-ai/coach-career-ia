import { describe, expect, it } from "vitest";
import { loginPath, safeCallbackUrl } from "@/lib/auth/redirect";

describe("safeCallbackUrl", () => {
  it.each([
    ["/app", "/app"],
    ["/app/memoire", "/app/memoire"],
    ["/app?onglet=1", "/app?onglet=1"],
  ])("accepte %s", (input, expected) => {
    expect(safeCallbackUrl(input)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "https://malveillant.example/app",
    "//malveillant.example/app",
    "/application",
    "/app//malveillant.example",
    "/app/\\malveillant.example",
    "/",
  ])("rejette %s", (input) => {
    expect(safeCallbackUrl(input)).toBe("/app");
  });
});

describe("loginPath", () => {
  it("conserve une destination interne", () => {
    expect(loginPath("/app/garde-fous")).toBe("/connexion?callbackUrl=%2Fapp%2Fgarde-fous");
  });

  it("retombe sur /app pour une destination absente ou externe", () => {
    expect(loginPath(null)).toBe("/connexion?callbackUrl=%2Fapp");
    expect(loginPath("https://malveillant.example")).toBe("/connexion?callbackUrl=%2Fapp");
  });
});
