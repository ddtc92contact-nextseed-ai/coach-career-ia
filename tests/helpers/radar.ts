import { readFileSync } from "node:fs";
import { HttpClient, type FetchLike } from "@/lib/radar/http";
import type { AtsCompany } from "@/lib/radar/connectors/ats";

export const TEST_USER_AGENT = "CoachCareerIA-Radar/1.0 (+https://exemple.test/contact)";

export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/radar/${name}`, import.meta.url), "utf8");
}

export function fixtureJson<T>(name: string): T {
  return JSON.parse(fixture(name)) as T;
}

export function jsonResponse(
  body: string | object | null,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const text = body === null ? null : typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

export type FetchCall = { url: string; init: RequestInit };

/** `fetch` simulé : aucune requête réseau, chaque appel est consigné. */
export function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: FetchCall[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return Object.assign(fn, { calls });
}

export const noSleep = async () => {};

export function testHttp(fetch: FetchLike, options: { now?: () => number } = {}): HttpClient {
  return new HttpClient({ userAgent: TEST_USER_AGENT, fetch, sleep: noSleep, ...options });
}

export function company(overrides: Partial<AtsCompany> = {}): AtsCompany {
  return {
    slug: "exemple",
    name: "Exemple",
    sector: "Logiciel",
    atsType: "GREENHOUSE",
    boardToken: "exemple",
    atsRegion: null,
    ...overrides,
  };
}

/** Routes de fixtures par préfixe d'URL. */
export function fixtureRoutes(routes: Record<string, () => Response>) {
  return fakeFetch((url) => {
    const prefix = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((p) => url.startsWith(p));
    if (!prefix) return new Response("not found", { status: 404 });
    return routes[prefix]!();
  });
}
