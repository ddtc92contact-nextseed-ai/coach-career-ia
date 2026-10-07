import { foldText } from "./text";

/**
 * Canal de candidature publié dans l'offre : une adresse e-mail de
 * candidature et/ou une URL « Postuler ». Uniquement ce que la source publie
 * POUR CANDIDATER : jamais de téléphone ni de nom de recruteur.
 *
 * Une adresse qui ressemble à celle d'une personne (`jean.dupont@…`) est
 * conservée, car c'est le canal publié, mais marquée `personal` : elle sert
 * uniquement à l'envoi, n'est jamais affichée ni journalisée.
 */

export type ApplyChannel = {
  email: string | null;
  /** L'adresse semble nominative (prénom.nom…) : jamais affichée ni journalisée. */
  emailPersonal: boolean;
  url: string | null;
};

export const NO_APPLY_CHANNEL: ApplyChannel = { email: null, emailPersonal: false, url: null };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
const EMAIL_ALL = new RegExp(EMAIL.source, "gi");
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/i;

/**
 * Mots d'une adresse « de service » (recrutement, RH, carrières…) dans les
 * six langues. Une adresse qui n'en contient aucun est traitée comme
 * nominative : c'est le choix prudent.
 */
const GENERIC_PARTS = [
  "recrutement",
  "recrutements",
  "recrute",
  "recruit",
  "recruiting",
  "recruitment",
  "recruiter",
  "recruiters",
  "rh",
  "drh",
  "hr",
  "rrhh",
  "job",
  "jobs",
  "emploi",
  "emplois",
  "career",
  "careers",
  "carriere",
  "carrieres",
  "candidature",
  "candidatures",
  "candidat",
  "candidats",
  "apply",
  "application",
  "applications",
  "talent",
  "talents",
  "people",
  "staffing",
  "hiring",
  "contact",
  "info",
  "infos",
  "hello",
  "bonjour",
  "team",
  "equipe",
  "accueil",
  "admin",
  "office",
  "bewerbung",
  "bewerbungen",
  "karriere",
  "personal",
  "empleo",
  "empleos",
  "seleccion",
  "lavoro",
  "lavora",
  "selezione",
  "vacature",
  "vacatures",
  "werken",
  "sollicitatie",
  "sollicitaties",
];
const GENERIC = new Set(GENERIC_PARTS);

/** Adresse e-mail valide (minuscules), ou `null`. */
export function cleanEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = EMAIL.exec(value);
  if (!match) return null;
  const email = match[0].toLowerCase().replace(/\.+$/, "");
  return email.length <= 254 ? email : null;
}

/** Vrai si l'adresse ne ressemble pas à une adresse de service (voir `GENERIC_PARTS`). */
export function isPersonalEmail(email: string): boolean {
  const local = foldText(email.split("@")[0] ?? "");
  const parts = local.split(/[^a-z0-9]+/).filter(Boolean);
  if (parts.some((part) => GENERIC.has(part.replace(/\d+$/, "")))) return false;
  // « recrutementparis », « jobsfrance » : le mot de service en préfixe suffit.
  if (GENERIC_PARTS.some((word) => word.length >= 4 && local.replace(/\s/g, "").startsWith(word))) {
    return false;
  }
  return true;
}

/** URL http(s) absolue, sans espaces, ou `null`. */
export function cleanApplyUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const match = URL_PATTERN.exec(raw);
  if (!match) return null;
  const candidate = match[0].replace(/[.,;:!?)]+$/, "");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return candidate.length <= 2000 ? candidate : null;
  } catch {
    return null;
  }
}

// Mots qui annoncent une adresse de candidature dans le texte d'une offre.
const APPLY_CONTEXT =
  /\b(?:postul\w*|candidat\w*|cv|curriculum|lettre de motivation|apply|application|send|resume|envoy\w*|adress\w*|bewerb\w*|lebenslauf|candidatura|inviare|invia|enviar|envia|sollicit\w*|stuur)\b/i;

/**
 * Adresse de candidature citée dans le texte de l'offre (« Envoyez votre CV
 * à recrutement@… »). Seule une adresse précédée, dans la même phrase, d'un
 * mot de candidature est retenue.
 */
export function applyEmailFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const match of text.matchAll(EMAIL_ALL)) {
    const start = match.index ?? 0;
    const before = text.slice(Math.max(0, start - 160), start);
    const sentence = before.split(/[.!?\n](?=\s|$)/).pop() ?? before;
    if (APPLY_CONTEXT.test(sentence)) return cleanEmail(match[0]);
  }
  return null;
}

/**
 * Canal normalisé à partir des valeurs de la source : `email` peut être un
 * texte libre (« Pour postuler : rh@… ») dont on extrait l'adresse.
 */
export function applyChannel(input: {
  email?: string | null;
  url?: string | null;
  description?: string | null;
}): ApplyChannel {
  const email = cleanEmail(input.email) ?? applyEmailFromText(input.description);
  return {
    email,
    emailPersonal: email ? isPersonalEmail(email) : false,
    url: cleanApplyUrl(input.url),
  };
}
