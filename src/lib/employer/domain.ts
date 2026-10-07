/**
 * Vérification du domaine d'une organisation : l'adresse e-mail du membre
 * fondateur doit appartenir au domaine du site déclaré. Les messageries
 * grand public sont refusées (n'importe qui peut y ouvrir une adresse). Sans
 * concordance, l'organisation reste en attente de validation par un
 * administrateur. Module pur : testable.
 */

/** Messageries grand public : jamais une preuve d'appartenance à une entreprise. */
export const FREE_WEBMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.fr",
  "ymail.com",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aol.fr",
  "gmx.com",
  "gmx.fr",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "tutanota.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "laposte.net",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "neuf.fr",
  "bbox.fr",
  "libero.it",
  "virgilio.it",
  "t-online.de",
  "freenet.de",
  "ziggo.nl",
  "kpnmail.nl",
  "telefonica.net",
  "skynet.be",
]);

/** Domaine d'une adresse e-mail, en minuscules ; `null` si l'adresse est invalide. */
export function emailDomain(email: string): string | null {
  const at = email.trim().lastIndexOf("@");
  if (at < 1) return null;
  const domain = email
    .trim()
    .slice(at + 1)
    .toLowerCase()
    .replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** Domaine d'un site web (`https://www.acme.fr/jobs` → `acme.fr`) ; `null` si invalide. */
export function websiteDomain(website: string): string | null {
  try {
    const url = new URL(website.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export const isFreeWebmail = (domain: string) => FREE_WEBMAIL_DOMAINS.has(domain.toLowerCase());

export type DomainCheck =
  | { verified: true; domain: string }
  | { verified: false; domain: string | null; reason: "webmail" | "mismatch" | "invalid" };

/**
 * Concordance du domaine de l'e-mail et de celui du site : identiques, ou
 * l'un sous-domaine de l'autre (`rh.acme.fr` ↔ `acme.fr`).
 */
export function checkMemberDomain(email: string, website: string): DomainCheck {
  const site = websiteDomain(website);
  const mail = emailDomain(email);
  if (!site || !mail) return { verified: false, domain: site, reason: "invalid" };
  if (isFreeWebmail(mail) || isFreeWebmail(site)) {
    return { verified: false, domain: site, reason: "webmail" };
  }
  const matches = mail === site || mail.endsWith(`.${site}`) || site.endsWith(`.${mail}`);
  return matches
    ? { verified: true, domain: site }
    : { verified: false, domain: site, reason: "mismatch" };
}
