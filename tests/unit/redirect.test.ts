import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/lib/auth/redirect";

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
