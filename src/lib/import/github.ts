import { ImportError } from "./errors";
import { GITHUB_USERNAME, IMPORT_LIMITS } from "./shared";

/**
 * Dépôts publics GitHub d'un identifiant : langages, étoiles, description et
 * extrait du README, proposés comme preuves (liens vers les dépôts).
 * API REST publique ; `GITHUB_TOKEN` (facultatif) relève la limite de 60
 * requêtes par heure.
 */

export type GithubRepo = {
  name: string;
  url: string;
  description: string;
  languages: string[];
  stars: number;
  pushedAt: string;
  readmeExcerpt: string;
};

export type GithubProfile = { username: string; profileUrl: string; repos: GithubRepo[] };

export type GithubFetch = (url: string, init: RequestInit) => Promise<Response>;

type ApiRepo = {
  name?: string;
  html_url?: string;
  description?: string | null;
  fork?: boolean;
  archived?: boolean;
  stargazers_count?: number;
  pushed_at?: string;
  language?: string | null;
};

const API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;

export async function fetchGithubProfile(
  rawUsername: string,
  options: { fetch?: GithubFetch; token?: string; signal?: AbortSignal } = {},
): Promise<GithubProfile> {
  const username = rawUsername.trim().replace(/^@/, "");
  if (!GITHUB_USERNAME.test(username)) throw new ImportError("githubInvalid");
  const doFetch: GithubFetch = options.fetch ?? ((url, init) => fetch(url, init));

  async function get(path: string, accept = "application/vnd.github+json"): Promise<Response> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      return await doFetch(`${API}${path}`, {
        headers: {
          Accept: accept,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "CoachCareerIA-Import",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
    } catch {
      throw new ImportError("githubUnavailable");
    }
  }

  const listing = await get(
    `/users/${encodeURIComponent(username)}/repos?type=owner&sort=pushed&per_page=100`,
  );
  if (listing.status === 404) throw new ImportError("githubNotFound");
  if (!listing.ok) throw new ImportError("githubUnavailable");
  const all = (await listing.json().catch(() => [])) as ApiRepo[];
  if (!Array.isArray(all)) throw new ImportError("githubUnavailable");

  // Dépôts originaux, les plus suivis puis les plus récents.
  const selected = all
    .filter((repo) => repo.name && repo.html_url && !repo.fork && !repo.archived)
    .sort(
      (a, b) =>
        (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0) ||
        (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""),
    )
    .slice(0, IMPORT_LIMITS.githubMaxRepos);

  const repos = await Promise.all(
    selected.map(async (repo): Promise<GithubRepo> => {
      const path = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo.name!)}`;
      const [languages, readme] = await Promise.all([
        get(`${path}/languages`)
          .then(async (r) => (r.ok ? ((await r.json()) as Record<string, number>) : {}))
          .catch(() => ({}) as Record<string, number>),
        get(`${path}/readme`, "application/vnd.github.raw")
          .then(async (r) => (r.ok ? await r.text() : ""))
          .catch(() => ""),
      ]);
      const languageNames = Object.entries(languages)
        .sort(([, a], [, b]) => b - a)
        .map(([name]) => name)
        .slice(0, 5);
      if (!languageNames.length && repo.language) languageNames.push(repo.language);
      return {
        name: repo.name!,
        url: repo.html_url!,
        description: repo.description ?? "",
        languages: languageNames,
        stars: repo.stargazers_count ?? 0,
        pushedAt: repo.pushed_at ?? "",
        readmeExcerpt: readmeExcerpt(readme),
      };
    }),
  );
  return { username, profileUrl: `https://github.com/${username}`, repos };
}

/** Début du README en texte brut : sans images, badges ni balises HTML. */
export function readmeExcerpt(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, IMPORT_LIMITS.githubReadmeChars);
}
