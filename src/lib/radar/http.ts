import { ALLOW_ALL, DISALLOW_ALL, parseRobots, type RobotsRules } from "./robots";

/**
 * Client HTTP « poli » du radar, seul point de sortie réseau des connecteurs :
 * - User-Agent honnête : nom du produit + contact (jamais d'usurpation) ;
 * - débit limité par hôte (créneaux réservés, pas de rafale) ;
 * - nouvelles tentatives espacées sur 429 / 5xx, en respectant `Retry-After` ;
 * - requêtes conditionnelles (`ETag` / `Last-Modified`) avec cache mémoire ;
 * - robots.txt vérifié pour toute URL qui n'est pas une API documentée.
 * Pas de navigateur headless, pas de proxy, pas de contournement.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type HttpClientOptions = {
  /** Ex. « CoachCareerIA-Radar/1.0 (+https://exemple.fr/contact) ». */
  userAgent: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Intervalle minimal entre deux requêtes vers un même hôte (défaut 1 s). */
  minIntervalMs?: number;
  /** Intervalles spécifiques par hôte. */
  hostIntervals?: Record<string, number>;
  maxRetries?: number;
  baseBackoffMs?: number;
  /** Au-delà, on abandonne plutôt que d'attendre (Retry-After trop long). */
  maxBackoffMs?: number;
  timeoutMs?: number;
  /** Taille maximale du cache conditionnel (octets). */
  cacheMaxBytes?: number;
};

export type RequestOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** `page` = URL non-API : robots.txt est vérifié avant toute requête. */
  kind?: "api" | "page";
  /**
   * Vérifie aussi robots.txt pour une API : endpoints publics servis par le
   * site carrière ou par un hôte qui publie des règles (Recruitee, Workable,
   * SmartRecruiters).
   */
  robots?: boolean;
};

export type HttpResponse = {
  status: number;
  headers: Headers;
  body: string;
  /** Vrai si la réponse vient du cache après un 304. */
  fromCache: boolean;
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
    detail?: string,
  ) {
    super(`HTTP ${status} sur ${safeUrl(url)}${detail ? ` (${detail})` : ""}`);
    this.name = "HttpError";
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt interdit ${safeUrl(url)}`);
    this.name = "RobotsDisallowedError";
  }
}

/** URL sans paramètres (ils peuvent contenir des identifiants). */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "[url invalide]";
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

type CacheEntry = {
  etag: string | null;
  lastModified: string | null;
  body: string;
  status: number;
};

export class HttpClient {
  private readonly opts: Required<Omit<HttpClientOptions, "hostIntervals">> & {
    hostIntervals: Record<string, number>;
  };
  private readonly nextSlot = new Map<string, number>();
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private readonly robots = new Map<string, Promise<RobotsRules>>();

  constructor(options: HttpClientOptions) {
    if (!/\(\+?.+\)/.test(options.userAgent)) {
      throw new Error("Le User-Agent du radar doit inclure un contact : « Produit/x (+contact) ».");
    }
    this.opts = {
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      minIntervalMs: 1000,
      maxRetries: 3,
      baseBackoffMs: 2000,
      maxBackoffMs: 120_000,
      timeoutMs: 30_000,
      cacheMaxBytes: 32 * 1024 * 1024,
      // Les options explicitement `undefined` ne remplacent pas les valeurs par défaut.
      ...(Object.fromEntries(
        Object.entries(options).filter(([, v]) => v !== undefined),
      ) as Partial<HttpClientOptions>),
      userAgent: options.userAgent,
      hostIntervals: options.hostIntervals ?? {},
    };
  }

  get userAgent(): string {
    return this.opts.userAgent;
  }

  async getJson<T>(
    url: string,
    options: RequestOptions = {},
  ): Promise<{ status: number; headers: Headers; data: T | null }> {
    const res = await this.request(url, {
      ...options,
      headers: { Accept: "application/json", ...options.headers },
    });
    const data = res.body.trim() ? (JSON.parse(res.body) as T) : null;
    return { status: res.status, headers: res.headers, data };
  }

  async request(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const method = options.method ?? "GET";
    const checkRobots = options.kind === "page" || options.robots === true;
    if (checkRobots && !(await this.robotsFor(url)).isAllowed(pathOf(url))) {
      throw new RobotsDisallowedError(url);
    }

    const cacheKey = method === "GET" ? url : null;
    const cached = cacheKey ? this.cache.get(cacheKey) : undefined;
    const headers: Record<string, string> = {
      ...options.headers,
      "User-Agent": this.opts.userAgent,
    };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

    for (let attempt = 0; ; attempt++) {
      await this.throttle(url);
      let response: Response;
      try {
        response = await this.opts.fetch(url, {
          method,
          headers,
          body: options.body,
          redirect: "follow",
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
      } catch (error) {
        if (attempt >= this.opts.maxRetries) {
          const reason = error instanceof Error ? error.name : "erreur réseau";
          throw new HttpError(0, url, reason);
        }
        await this.backoff(url, this.defaultDelay(attempt));
        continue;
      }

      if (response.status === 304 && cached) {
        return {
          status: cached.status,
          headers: response.headers,
          body: cached.body,
          fromCache: true,
        };
      }

      if (RETRYABLE.has(response.status)) {
        const delay =
          retryAfterMs(response.headers.get("retry-after"), this.opts.now()) ??
          this.defaultDelay(attempt);
        if (attempt >= this.opts.maxRetries || delay > this.opts.maxBackoffMs) {
          throw new HttpError(response.status, url, `abandon après ${attempt + 1} tentative(s)`);
        }
        await response.body?.cancel();
        await this.backoff(url, delay);
        continue;
      }

      const body = await response.text();
      if (response.status < 200 || response.status >= 300)
        throw new HttpError(response.status, url);

      if (cacheKey) this.store(cacheKey, response, body);
      return { status: response.status, headers: response.headers, body, fromCache: false };
    }
  }

  private defaultDelay(attempt: number): number {
    return Math.min(this.opts.baseBackoffMs * 2 ** attempt, this.opts.maxBackoffMs);
  }

  /** Réserve le prochain créneau de l'hôte puis attend son tour. */
  private async throttle(url: string): Promise<void> {
    const host = hostOf(url);
    const interval = this.opts.hostIntervals[host] ?? this.opts.minIntervalMs;
    const now = this.opts.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + interval);
    if (slot > now) await this.opts.sleep(slot - now);
  }

  /** Repousse aussi les requêtes suivantes vers cet hôte. */
  private async backoff(url: string, delay: number): Promise<void> {
    const host = hostOf(url);
    const resumeAt = this.opts.now() + delay;
    this.nextSlot.set(host, Math.max(this.nextSlot.get(host) ?? 0, resumeAt));
    await this.opts.sleep(delay);
  }

  private store(key: string, response: Response, body: string) {
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    const previous = this.cache.get(key);
    if (previous) {
      this.cache.delete(key);
      this.cacheBytes -= previous.body.length;
    }
    if ((!etag && !lastModified) || body.length > this.opts.cacheMaxBytes / 4) return;
    this.cache.set(key, { etag, lastModified, body, status: response.status });
    this.cacheBytes += body.length;
    for (const [oldKey, entry] of this.cache) {
      if (this.cacheBytes <= this.opts.cacheMaxBytes) break;
      this.cache.delete(oldKey);
      this.cacheBytes -= entry.body.length;
    }
  }

  private robotsFor(url: string): Promise<RobotsRules> {
    const origin = new URL(url).origin;
    let rules = this.robots.get(origin);
    if (!rules) {
      rules = this.loadRobots(origin);
      this.robots.set(origin, rules);
    }
    return rules;
  }

  private async loadRobots(origin: string): Promise<RobotsRules> {
    const token = this.opts.userAgent.split("/")[0]!;
    try {
      const res = await this.request(`${origin}/robots.txt`, { headers: { Accept: "text/plain" } });
      return parseRobots(res.body, token);
    } catch (error) {
      // RFC 9309 : robots.txt absent (4xx) → accès libre ; injoignable (5xx) → tout interdit.
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) return ALLOW_ALL;
      return DISALLOW_ALL;
    }
  }
}

function hostOf(url: string): string {
  return new URL(url).host.toLowerCase();
}

function pathOf(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

/** `Retry-After` en secondes ou en date HTTP. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}
