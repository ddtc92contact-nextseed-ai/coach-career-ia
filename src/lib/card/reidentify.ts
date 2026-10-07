import { isIdentityUrl } from "@/lib/import/pseudonymise";
import { publicCard, type CardContent } from "./schema";

/**
 * Contrôle de ré-identification, exécuté AVANT CHAQUE PARTAGE de la carte
 * (validation, envoi d'un message, lien à coller). Déterministe, sans IA : un
 * partage n'est possible que si la carte publique ne présente aucun problème.
 *
 * Ce qui est cherché, dans tous les textes visibles par l'entreprise :
 * - coordonnées (e-mail, téléphone) et liens dans le texte ;
 * - liens de preuve qui désignent une personne (profil LinkedIn, GitHub…), et
 *   tout lien de preuve si le candidat ne les a pas autorisés ;
 * - termes connus du candidat : parties de l'adresse du compte, entreprises
 *   exclues, entreprises connues du radar et — dans le navigateur seulement,
 *   coffre déverrouillé — nom, employeurs, écoles et liens du coffre ;
 * - employeurs (« chez X », « at X », forme juridique) et écoles (« École… »,
 *   « Université… », grandes écoles) ;
 * - dates (jour, mois, année) : avec un intitulé de poste, une date exacte
 *   suffit souvent à retrouver quelqu'un. La carte n'en contient jamais ; les
 *   durées (« 6 ans d'expérience ») restent possibles.
 *
 * Partagé avec le navigateur : aucune dépendance serveur.
 */

export const REIDENTIFICATION_CODES = [
  "contact",
  "url",
  "identityUrl",
  "knownTerm",
  "employer",
  "school",
  "date",
  "headlineMissing",
] as const;
export type ReidentificationCode = (typeof REIDENTIFICATION_CODES)[number];

export type ReidentificationIssue = {
  code: ReidentificationCode;
  /** Champ concerné (`headline`, `achievements.0.result`, `skills.2`…). */
  path: string;
  /** Extrait en cause, montré au seul candidat (jamais journalisé). */
  excerpt?: string;
};

export type CheckContext = {
  /** Termes identifiants (noms, employeurs, écoles…), comparés sans casse ni accents. */
  terms: string[];
};

const EMAIL = /[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[a-z]{2,}/iu;
const PHONE =
  /(?:\+|\b00)\d{1,3}[\s.-]?(?:\(0\)[\s.-]?)?\d(?:[\s.-]?\d){6,11}\b|\b0\d(?:[\s.-]?\d{2}){4}\b/;
const URL_IN_TEXT =
  /\bhttps?:\/\/\S+|\bwww\.\S+|\b[\w-]+\.(?:com|fr|org|eu|de|es|it|nl|be|ch)(?:\/\S*)?\b/i;

/** Écoles : mots génériques (toutes langues), sans tenir compte de la casse. */
const SCHOOL_WORDS =
  /(?:^|[^\p{L}])(?:[ée]cole|universit[éeàäy]\w*|universidad|universiteit|hochschule|fachhochschule|politecnico|polytechnique|polytechnic|business school|lyc[ée]e|grande [ée]cole|sciences ?po|centrale ?sup[ée]lec|mines paris\w*|t[ée]l[ée]com paris|dauphine|sorbonne|panth[ée]on|massachusetts institute|stanford|harvard|oxford|cambridge|bocconi|insead|emlyon|em lyon|kedge|neoma|skema|audencia|grenoble inp|tu delft|tu m[üu]nchen|eth z[üu]rich|epfl)(?:$|[^\p{L}])/iu;
/** Sigles d'écoles : en capitales seulement (« mit » est un mot allemand). */
const SCHOOL_ACRONYMS =
  /\b(?:HEC|ESSEC|ESCP|EDHEC|INSA|IUT|ENS|ENSAE|ENSTA|ENSAM|ENSIMAG|ENSEEIHT|EPITA|EPITECH|EFREI|ESIEA|ESILV|ISEP|UPMC|UCL|LSE|IAE)\b/u;

/** Employeur : « chez Acme », « at Acme », « bei Acme », « presso Acme », « bij Acme ». */
const EMPLOYER_AT = /(?:^|[\s(])(?:chez|at|bei|presso|bij)\s+(\p{Lu}[\p{L}\p{N}&'’.-]+)/gu;
/**
 * Mots en capitale qui suivent couramment ces prépositions sans désigner un
 * employeur : pronoms de politesse et noms communs allemands (« bei Ihnen »,
 * « bei Interesse »), formules néerlandaises, italiennes, anglaises, françaises.
 */
const NOT_EMPLOYERS = new Set([
  // de
  "ihnen",
  "ihrem",
  "ihrer",
  "ihren",
  "ihr",
  "ihre",
  "euch",
  "dir",
  "uns",
  "interesse",
  "fragen",
  "rückfragen",
  "bedarf",
  "gelegenheit",
  "bedarfsfall",
  "eignung",
  "zusage",
  // nl
  "u",
  "uw",
  "jullie",
  "vragen",
  "interesse",
  "voorkeur",
  // it
  "voi",
  "lei",
  "noi",
  "vostra",
  "vostro",
  // en
  "the",
  "this",
  "that",
  "your",
  "our",
  "least",
  "scale",
  "best",
  "first",
  // fr
  "vous",
  "nous",
  "moi",
  "soi",
]);

/** Premier nom d'employeur introduit par « chez/at/bei/presso/bij », ou `null`. */
function employerAfterPreposition(text: string): string | null {
  for (const match of text.matchAll(EMPLOYER_AT)) {
    const word = match[1]!.replace(/[.'’-]+$/, "");
    if (!NOT_EMPLOYERS.has(word.toLowerCase())) return word;
  }
  return null;
}
/** Raison sociale : « Acme SAS », « Foo Bar GmbH ». */
const LEGAL_FORM =
  /\p{Lu}[\p{L}\p{N}&'’.-]*(?:\s+\p{Lu}[\p{L}\p{N}&'’.-]*)*\s+(?:SAS|SASU|SARL|EURL|SA|SCOP|GmbH|AG|Inc\.?|Ltd\.?|LLC|BV|B\.V\.|NV|S\.p\.A\.|SpA|S\.L\.|SRL)(?![\p{L}])/u;

const MONTHS =
  "janv|janvier|f[ée]vr|f[ée]vrier|mars|avr|avril|mai|juin|juil|juillet|ao[uû]t|sept|septembre|oct|octobre|nov|novembre|d[ée]c|d[ée]cembre|jan|january|feb|february|march|apr|april|may|june|july|aug|august|sep|september|october|november|dec|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gennaio|febbraio|aprile|maggio|giugno|luglio|settembre|ottobre|dicembre|januar|februar|m[äa]rz|juni|juli|oktober|dezember|januari|februari|maart|mei|augustus|oktober";
const DATE_PATTERNS = [
  // 12/03/2021, 12.03.21, 2021-03-12
  /\b\d{1,2}[/.-]\d{1,2}[/.-](?:\d{2}|\d{4})\b/,
  /\b(?:19|20)\d{2}-\d{1,2}(?:-\d{1,2})?\b/,
  // 03/2021
  /\b(?:0?[1-9]|1[0-2])[/.-](?:19|20)\d{2}\b/,
  // « mars 2021 », « March 2021 »
  new RegExp(`(?:^|[^\\p{L}])(?:${MONTHS})\\.?\\s+(?:19|20)\\d{2}\\b`, "iu"),
  // Période : « 2018-2022 », « 2019 – 21 », « Q3 2024 », « S1 2023 ».
  /\b(?:19[5-9]\d|20[0-4]\d)\s*[-–—/]\s*(?:(?:19|20)\d{2}|\d{2})\b/,
  /\b[QTHS][1-4]\s*(?:19|20)\d{2}\b/,
  // Année introduite par une préposition : « depuis 2019 », « in 2021 », « seit 2020 ».
  /(?:^|[^\p{L}])(?:depuis|since|seit|desde|dal|sinds|en|in|im|nel|nell'|año|anno|jaar|jahr|ann[ée]e|year|from|de|du|au|à|to|until|bis|hasta|fino al|tot|jusqu'en|vanaf)\s+(?:19[5-9]\d|20[0-4]\d)\b/iu,
];

/** Minuscules sans accents, caractère par caractère (même longueur). */
function fold(text: string): string {
  let out = "";
  for (const char of text) {
    const folded = char.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += folded.length === char.length ? folded : char.toLowerCase().slice(0, char.length);
  }
  return out;
}

const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char);

/** Premier terme présent comme mot entier (sans casse ni accents), ou `null`. */
export function findTerm(text: string, terms: string[]): string | null {
  if (!text) return null;
  const haystack = fold(text);
  for (const term of terms) {
    const needle = fold(term.trim());
    if (needle.length < 2) continue;
    let from = 0;
    for (;;) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      const end = index + needle.length;
      if (!isWordChar(haystack[index - 1]) && !isWordChar(haystack[end])) {
        return text.slice(index, end);
      }
      from = index + 1;
    }
  }
  return null;
}

/** Problèmes d'un texte libre de la carte. */
export function checkText(text: string, path: string, context: CheckContext) {
  const issues: ReidentificationIssue[] = [];
  if (!text.trim()) return issues;
  const push = (code: ReidentificationCode, excerpt?: string | null) =>
    issues.push({ code, path, ...(excerpt ? { excerpt: excerpt.trim().slice(0, 80) } : {}) });

  const email = EMAIL.exec(text);
  if (email) push("contact", email[0]);
  else {
    const phone = PHONE.exec(text);
    if (phone) push("contact", phone[0]);
  }
  const url = URL_IN_TEXT.exec(text);
  if (url && !email) push("url", url[0]);
  const term = findTerm(text, context.terms);
  if (term) push("knownTerm", term);
  const employer = employerAfterPreposition(text) ?? LEGAL_FORM.exec(text)?.[0];
  if (employer) push("employer", employer);
  const school = SCHOOL_WORDS.exec(text) ?? SCHOOL_ACRONYMS.exec(text);
  if (school) push("school", school[0]);
  for (const pattern of DATE_PATTERNS) {
    const date = pattern.exec(text);
    if (date) {
      push("date", date[0]);
      break;
    }
  }
  return issues;
}

/** L'offre destinataire d'un message : son intitulé et son entreprise ne sont pas des données du candidat. */
export type MessageTarget = { offerTitle: string; companyName: string | null };

const LEGAL_SUFFIX = /\s+(?:SAS|SASU|SARL|EURL|SA|SE|GmbH|AG|Inc\.?|Ltd\.?|LLC|BV|NV|SpA|SRL)$/i;

function targetNames(target: MessageTarget): string[] {
  const names = [
    target.offerTitle,
    target.companyName,
    target.companyName?.replace(LEGAL_SUFFIX, ""),
  ];
  return [...new Set(names.map((n) => n?.trim() ?? "").filter((n) => n.length >= 2))].sort(
    (a, b) => b.length - a.length,
  );
}

/**
 * Termes identifiants SANS l'entreprise destinataire : la nommer dans un
 * message qui lui est adressé ne révèle rien du candidat (une entreprise
 * qu'il exclut ne passe de toute façon pas les garde-fous).
 */
export function termsForTarget(terms: string[], target: MessageTarget): string[] {
  const company = target.companyName?.trim();
  if (!company) return terms;
  const names = [company, company.replace(LEGAL_SUFFIX, "")];
  return terms.filter(
    (term) => !names.some((name) => findTerm(name, [term]) || findTerm(term, [name])),
  );
}

/** Retire du texte l'intitulé de l'offre et le nom de l'entreprise (sans casse ni accents). */
export function stripTarget(text: string, target: MessageTarget): string {
  let result = text;
  for (const name of targetNames(target)) {
    for (;;) {
      const found = findTerm(result, [name]);
      if (!found) break;
      result = result.replace(found, " ");
    }
  }
  return result;
}

/**
 * Contrôle d'un message adressé à une entreprise : le texte de l'offre (titre
 * avec ses dates, nom de l'entreprise) n'est pas une donnée du candidat et
 * n'est donc pas contrôlé ; tout le reste l'est, comme pour la carte.
 */
export function checkMessage(
  text: string,
  path: string,
  context: CheckContext & { target: MessageTarget },
): ReidentificationIssue[] {
  return checkText(stripTarget(text, context.target), path, {
    terms: termsForTarget(context.terms, context.target),
  });
}

/**
 * Contrôle complet de la carte telle que l'entreprise la verrait
 * (`publicCard`). Liste vide = partage possible.
 */
export function checkCard(card: CardContent, context: CheckContext): ReidentificationIssue[] {
  const shown = publicCard(card);
  const issues: ReidentificationIssue[] = [];
  if (!shown.headline.trim()) issues.push({ code: "headlineMissing", path: "headline" });
  issues.push(...checkText(shown.headline, "headline", context));
  shown.achievements.forEach((a, i) => {
    issues.push(...checkText(a.title, `achievements.${i}.title`, context));
    issues.push(...checkText(a.result, `achievements.${i}.result`, context));
    a.skills.forEach((s, j) =>
      issues.push(...checkText(s, `achievements.${i}.skills.${j}`, context)),
    );
    a.proofUrls.forEach((url, j) => {
      const path = `achievements.${i}.proofUrls.${j}`;
      if (isIdentityUrl(url)) issues.push({ code: "identityUrl", path, excerpt: url });
      else {
        const term = findTerm(url.replace(/[/._-]+/g, " "), context.terms);
        if (term) issues.push({ code: "knownTerm", path, excerpt: term });
      }
    });
  });
  shown.skills.forEach((s, i) => issues.push(...checkText(s.name, `skills.${i}`, context)));
  shown.rails.locations.forEach((l, i) => {
    const term = findTerm(l.label, context.terms);
    if (term) issues.push({ code: "knownTerm", path: `rails.locations.${i}`, excerpt: term });
  });
  return issues;
}

/**
 * Termes identifiants du coffre (navigateur uniquement) : nom, prénom,
 * employeurs, écoles et liens. Ne quitte jamais le navigateur.
 */
export function vaultTerms(identity: {
  firstName: string;
  lastName: string;
  email: string;
  employers: { name: string }[];
  schools: { name: string }[];
  links: { url: string }[];
}): string[] {
  const terms = [
    identity.firstName,
    identity.lastName,
    `${identity.firstName} ${identity.lastName}`,
    identity.email.split("@")[0] ?? "",
    ...identity.employers.map((e) => e.name),
    ...identity.schools.map((s) => s.name),
    ...identity.links.flatMap((l) => {
      try {
        const { pathname } = new URL(l.url);
        return pathname.split("/").filter((p) => p.length >= 3);
      } catch {
        return [];
      }
    }),
  ];
  return [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].sort(
    (a, b) => b.length - a.length,
  );
}
