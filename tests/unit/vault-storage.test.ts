import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou statique : aucune donnée d'identité ne doit être persistée côté
 * navigateur. Le seul usage autorisé du stockage local est la préférence de
 * verrouillage automatique du coffre (un nombre de minutes, non identifiant) ;
 * le seul cookie écrit par le navigateur mémorise le menu latéral réduit.
 */

const ROOT = path.resolve(import.meta.dirname, "../../src");
const STORAGE = /\b(localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (entry === "generated") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("coffre d'identité : rien n'est persisté dans le navigateur", () => {
  it("n'utilise le stockage local que pour la durée de verrouillage", () => {
    const usages = sourceFiles(ROOT).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ file: path.relative(ROOT, file), line: index + 1, text: line }))
        .filter(({ text }) => STORAGE.test(text) && !/^\s*(\*|\/\/)/.test(text)),
    );
    expect(usages.map((u) => `${u.file}: ${u.text.trim()}`)).toEqual([
      'components/shell/app-shell.tsx: document.cookie = sidebarCookie(next, window.location.protocol === "https:");',
      "components/vault/vault-provider.tsx: const value = Number(window.localStorage.getItem(IDLE_STORAGE_KEY));",
      "components/vault/vault-provider.tsx: window.localStorage.setItem(IDLE_STORAGE_KEY, String(minutes));",
    ]);
  });

  it("le module de chiffrement n'importe ni ne contacte rien", () => {
    const source = readFileSync(path.join(ROOT, "lib/vault/crypto.ts"), "utf8");
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|console\./);
  });
});
