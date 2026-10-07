/**
 * Pseudonymisation déterministe, qui ne dépend pas du modèle :
 * - AVANT l'appel au modèle, les e-mails, téléphones et liens du CV sont
 *   remplacés par des repères (`[EMAIL]`, `[PHONE]`, `[LINK 3]`) ;
 * - APRÈS, tout nom repéré (personne, employeur, école, client…) encore
 *   présent dans le brouillon est remplacé par `[…]` et l'élément est signalé.
 */

export const REDACTION = "[…]";

const EMAIL = /[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[a-z]{2,}/giu;
/** International (`+33 6…`, `0049 170…`) ou national français (`06 12 34 56 78`). */
const PHONE =
  /(?:\+|\b00)\d{1,3}[\s.-]?(?:\(0\)[\s.-]?)?\d(?:[\s.-]?\d){6,11}\b|\b0\d(?:[\s.-]?\d{2}){4}\b/g;
const URL_PATTERN =
  /\bhttps?:\/\/[^\s<>"'()\[\]]+|\b(?:www\.)[^\s<>"'()\[\]]+|\b(?:linkedin\.com|github\.com|gitlab\.com)\/[^\s<>"'()\[\]]+/gi;
const LINK_TOKEN = /\[?\bLINK\s*(\d+)\]?/gi;

export type LinkTable = {
  urls: string[];
  /** Ajoute un lien et renvoie son repère (`[LINK n]`). */
  add(url: string): string;
};

export function createLinkTable(): LinkTable {
  const urls: string[] = [];
  return {
    urls,
    add(raw) {
      const url = normalizeUrl(raw);
      let index = urls.indexOf(url);
      if (index < 0) index = urls.push(url) - 1;
      return `[LINK ${index + 1}]`;
    },
  };
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.replace(/[.,;:!?]+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** URL citée par un repère `LINK n` (ou `[LINK n]`). */
export function resolveLinkToken(token: string, table: LinkTable): string | null {
  const match = /LINK\s*(\d+)/i.exec(token);
  if (!match) return null;
  return table.urls[Number(match[1]) - 1] ?? null;
}

/** Sites dont la racine `/<pseudo>` est un profil personnel. */
const PROFILE_HOSTS = [
  "github.com",
  "gitlab.com",
  "twitter.com",
  "x.com",
  "dribbble.com",
  "behance.net",
  "medium.com",
  "bsky.app",
];

/** Profil personnel (LinkedIn, GitHub/GitLab sans dépôt…) : identifiant, jamais une preuve. */
export function isIdentityUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.replace(/^www\./, "").toLowerCase();
    const segments = pathname.split("/").filter(Boolean);
    if (host.endsWith("linkedin.com")) return true;
    if (PROFILE_HOSTS.includes(host)) {
      return segments.length <= 1;
    }
    return false;
  } catch {
    return true;
  }
}

export type MaskedText = {
  text: string;
  emails: string[];
  phones: string[];
  identityLinks: string[];
};

/** Retire e-mails, téléphones et liens d'un texte avant de l'envoyer au modèle. */
export function maskContacts(text: string, links: LinkTable): MaskedText {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const identityLinks = new Set<string>();
  const masked = text
    .replace(EMAIL, (email) => {
      emails.add(email);
      return "[EMAIL]";
    })
    .replace(URL_PATTERN, (raw) => {
      // La ponctuation finale (« voir https://x.test. ») reste dans le texte.
      const trailing = /[.,;:!?]+$/.exec(raw)?.[0] ?? "";
      const url = normalizeUrl(raw);
      if (isIdentityUrl(url)) {
        identityLinks.add(url);
        return `[PROFILE LINK]${trailing}`;
      }
      return `${links.add(url)}${trailing}`;
    })
    .replace(PHONE, (phone) => {
      phones.add(phone.trim());
      return "[PHONE]";
    });
  return {
    text: masked,
    emails: [...emails],
    phones: [...phones],
    identityLinks: [...identityLinks],
  };
}

// --- Après le modèle : retrait des noms ------------------------------------------

/** Minuscules sans accents, caractère par caractère (même longueur que l'original). */
function fold(text: string): string {
  let out = "";
  for (const char of text) {
    const folded = char.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    // Les caractères qui changeraient de longueur (ligatures…) sont gardés tels quels.
    out += folded.length === char.length ? folded : char.toLowerCase().slice(0, char.length);
  }
  return out;
}

const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char);

/**
 * Termes à retirer : noms complets, et parties de noms de personnes de 3
 * lettres ou plus (« Jeanne », « Testard »). Les plus longs d'abord.
 */
export function identityTerms(input: { people: string[]; names: string[] }): string[] {
  const terms = new Set<string>();
  const add = (term: string) => {
    const clean = term.trim().replace(/\s+/g, " ");
    if (clean.length >= 2) terms.add(clean);
  };
  for (const name of input.names) {
    add(name);
    // « Qonto SAS » → aussi « Qonto ».
    add(
      name.replace(/\b(SAS|SA|SARL|SASU|GmbH|AG|BV|B\.V\.|Ltd|LLC|Inc\.?|S\.p\.A\.|S\.L\.)$/i, ""),
    );
  }
  for (const person of input.people) {
    add(person);
    for (const part of person.split(/[\s-]+/)) if (part.length >= 3) add(part);
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

/** Remplace chaque terme (sans tenir compte de la casse ni des accents, mots entiers). */
export function redactTerms(text: string, terms: string[]): { text: string; changed: boolean } {
  if (!text || terms.length === 0) return { text, changed: false };
  let result = text;
  let changed = false;
  for (const term of terms) {
    const needle = fold(term);
    let haystack = fold(result);
    let from = 0;
    for (;;) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      const end = index + needle.length;
      if (isWordChar(haystack[index - 1]) || isWordChar(haystack[end])) {
        from = index + 1;
        continue;
      }
      result = result.slice(0, index) + REDACTION + result.slice(end);
      haystack = fold(result);
      from = index + REDACTION.length;
      changed = true;
    }
  }
  return { text: result, changed };
}

/** Retire aussi les contacts et repères de liens qu'aurait recopiés le modèle. */
export function redactText(text: string, terms: string[]): { text: string; changed: boolean } {
  let changed = false;
  const contacts = text
    .replace(EMAIL, () => ((changed = true), REDACTION))
    .replace(URL_PATTERN, () => ((changed = true), REDACTION))
    .replace(PHONE, () => ((changed = true), REDACTION))
    .replace(/\[(?:EMAIL|PHONE|PROFILE LINK)\]/g, () => ((changed = true), REDACTION))
    .replace(LINK_TOKEN, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const named = redactTerms(contacts, terms);
  return { text: named.text, changed: changed || named.changed };
}
