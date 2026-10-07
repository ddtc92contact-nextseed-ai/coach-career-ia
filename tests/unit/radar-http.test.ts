import { describe, expect, it } from "vitest";
import { HttpClient, HttpError, RobotsDisallowedError, retryAfterMs } from "@/lib/radar/http";
import { TEST_USER_AGENT, fakeFetch, jsonResponse } from "../helpers/radar";

function clock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

describe("client HTTP poli", () => {
  it("exige un User-Agent honnête avec contact et l'envoie", async () => {
    expect(() => new HttpClient({ userAgent: "Mozilla/5.0" })).toThrow(/contact/);
    const fetch = fakeFetch(() => jsonResponse({ ok: true }));
    const c = clock();
    await new HttpClient({ userAgent: TEST_USER_AGENT, fetch, ...c }).getJson(
      "https://api.exemple.test/a",
    );
    const headers = fetch.calls[0]!.init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(TEST_USER_AGENT);
  });

  it("espace les requêtes vers un même hôte, pas entre hôtes différents", async () => {
    const fetch = fakeFetch(() => jsonResponse({}));
    const c = clock();
    const http = new HttpClient({ userAgent: TEST_USER_AGENT, fetch, minIntervalMs: 1000, ...c });
    await http.getJson("https://a.test/1");
    await http.getJson("https://a.test/2");
    await http.getJson("https://b.test/1");
    await http.getJson("https://a.test/3");
    expect(c.sleeps).toEqual([1000, 1000]);
  });

  it("respecte Retry-After sur 429 puis réussit", async () => {
    let n = 0;
    const fetch = fakeFetch(() =>
      ++n === 1
        ? jsonResponse(null, { status: 429, headers: { "Retry-After": "7" } })
        : jsonResponse({ ok: 1 }),
    );
    const c = clock();
    const http = new HttpClient({ userAgent: TEST_USER_AGENT, fetch, minIntervalMs: 0, ...c });
    const res = await http.getJson<{ ok: number }>("https://a.test/x");
    expect(res.data).toEqual({ ok: 1 });
    expect(c.sleeps).toContain(7000);
  });

  it("recule exponentiellement sur 5xx puis abandonne", async () => {
    const fetch = fakeFetch(() => jsonResponse(null, { status: 503 }));
    const c = clock();
    const http = new HttpClient({
      userAgent: TEST_USER_AGENT,
      fetch,
      minIntervalMs: 0,
      maxRetries: 2,
      baseBackoffMs: 100,
      ...c,
    });
    const error = await http.getJson("https://a.test/x?token=secret").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    // Les paramètres d'URL n'apparaissent jamais dans le message d'erreur.
    expect((error as Error).message).not.toMatch(/secret/);
    expect(fetch.calls).toHaveLength(3);
    expect(c.sleeps).toEqual([100, 200]);
  });

  it("abandonne si Retry-After dépasse le plafond", async () => {
    const fetch = fakeFetch(() =>
      jsonResponse(null, { status: 429, headers: { "Retry-After": "3600" } }),
    );
    const http = new HttpClient({
      userAgent: TEST_USER_AGENT,
      fetch,
      maxBackoffMs: 60_000,
      ...clock(),
    });
    await expect(http.getJson("https://a.test/x")).rejects.toThrow(/429/);
    expect(fetch.calls).toHaveLength(1);
  });

  it("utilise les requêtes conditionnelles (ETag → 304 servi depuis le cache)", async () => {
    const fetch = fakeFetch((_url, init) => {
      const headers = init.headers as Record<string, string>;
      return headers["If-None-Match"] === 'W/"v1"'
        ? new Response(null, { status: 304 })
        : jsonResponse({ jobs: [1] }, { headers: { ETag: 'W/"v1"' } });
    });
    const http = new HttpClient({ userAgent: TEST_USER_AGENT, fetch, ...clock() });
    const first = await http.request("https://a.test/board");
    const second = await http.request("https://a.test/board");
    expect(first.fromCache).toBe(false);
    expect(second).toMatchObject({ status: 200, fromCache: true, body: first.body });
  });

  it("vérifie robots.txt pour les URL qui ne sont pas des API", async () => {
    const fetch = fakeFetch((url) =>
      url.endsWith("/robots.txt")
        ? new Response("User-agent: *\nDisallow: /offres", { status: 200 })
        : new Response("<html></html>", { status: 200 }),
    );
    const http = new HttpClient({ userAgent: TEST_USER_AGENT, fetch, ...clock() });
    await expect(http.request("https://site.test/offres/1", { kind: "page" })).rejects.toThrow(
      RobotsDisallowedError,
    );
    await expect(
      http.request("https://site.test/a-propos", { kind: "page" }),
    ).resolves.toMatchObject({
      status: 200,
    });
    // robots.txt n'est lu qu'une fois par origine.
    expect(fetch.calls.filter((c) => c.url.endsWith("/robots.txt"))).toHaveLength(1);
  });

  it("robots.txt injoignable (5xx) → tout est interdit", async () => {
    const fetch = fakeFetch(() => new Response("", { status: 500 }));
    const http = new HttpClient({ userAgent: TEST_USER_AGENT, fetch, maxRetries: 0, ...clock() });
    await expect(http.request("https://site.test/x", { kind: "page" })).rejects.toThrow(
      RobotsDisallowedError,
    );
  });

  it("lit Retry-After en secondes ou en date HTTP", () => {
    expect(retryAfterMs("120", 0)).toBe(120_000);
    expect(retryAfterMs(new Date(5000).toUTCString(), 0)).toBe(5000);
    expect(retryAfterMs("n'importe quoi", 0)).toBeNull();
  });
});
