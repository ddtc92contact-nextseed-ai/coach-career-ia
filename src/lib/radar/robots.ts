/**
 * Lecture minimale de robots.txt (RFC 9309) : groupes `User-agent`, règles
 * `Allow` / `Disallow` avec `*` et `$`, la règle la plus longue l'emporte.
 */

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[] };

export type RobotsRules = { isAllowed(path: string): boolean };

function parseGroups(body: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/** `productToken` : jeton produit de notre User-Agent (ex. « CoachCareerIA-Radar »). */
export function parseRobots(body: string, productToken: string): RobotsRules {
  const groups = parseGroups(body);
  const token = productToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const applicable = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = applicable.flatMap((g) => g.rules);
  return {
    isAllowed(path: string) {
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!matches(rule.pattern, path)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true };
export const DISALLOW_ALL: RobotsRules = { isAllowed: () => false };
