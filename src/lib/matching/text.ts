import { truncateSafe } from "@/lib/text/truncate";

/**
 * Outils de texte du matching (fonctions pures) : normalisation sans accents
 * ni casse, recherche d'un terme entier, termes significatifs pondérés,
 * découpage en phrases.
 */

/** Minuscules, sans accents, apostrophes unifiées, espaces réduits. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Expression qui trouve `term` (déjà normalisé) comme terme entier : « java »
 * ne trouve pas « javascript », mais « c++ » ou « node.js » sont reconnus.
 */
export function termPattern(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}+#])`, "u");
}

/** Vrai si le texte normalisé contient le terme (normalisé) comme terme entier. */
export function containsTerm(normalizedText: string, term: string): boolean {
  const key = normalizeText(term);
  if (key.length < 1) return false;
  return termPattern(key).test(normalizedText);
}

/**
 * Mots vides (articles, prépositions…) des langues de l'application, déjà
 * normalisés : jamais des termes significatifs d'une compétence.
 */
const STOP_WORDS = new Set(
  [
    // français
    "le la les l un une des de du d au aux a à et ou en dans par pour sur sous avec sans chez",
    "ce cet cette ces son sa ses leur leurs mon ma mes notre nos votre vos qui que quoi dont",
    "est sont etre ete plus moins tres tout tous toute toutes h f hf fh",
    // anglais
    "the an and or of to in on at for with by from as is are be into our your their its",
    // allemand, espagnol, italien, néerlandais
    "der die das den dem und oder von zu im mit fur el los las y o del con por para",
    "il lo gli e di da per con nel het een en van voor op met",
  ]
    .join(" ")
    .split(" "),
);

/**
 * Mots d'un intitulé qui disent le RÔLE sans dire le MÉTIER (« gestionnaire »,
 * « technicien », « responsable »…) : ils comptent pour
 * `GENERIC_TERM_WEIGHT` d'un terme métier (« audiovisuel », « régie »).
 */
const GENERIC_TERMS = new Set(
  [
    "gestionnaire responsable chef cheffe charge chargee technicien technicienne ingenieur",
    "ingenieure assistant assistante agent agente expert experte specialiste consultant",
    "consultante conseiller conseillere coordinateur coordinatrice directeur directrice",
    "operateur operatrice employe employee manager adjoint adjointe referent referente",
    "superviseur superviseuse animateur animatrice collaborateur collaboratrice",
    "senior junior confirme confirmee debutant debutante stagiaire alternant alternante",
    "poste metier lead head officer engineer specialist technician director assistant",
    "coordinator advisor associate executive",
  ]
    .join(" ")
    .split(" "),
);

/**
 * Mots courants du travail, présents dans presque toutes les offres : ignorés
 * dans les responsabilités d'une expérience (ils ne disent rien du métier).
 */
const COMMON_WORK_TERMS = new Set(
  [
    "gestion suivi mise place equipe equipes client clients projet projets service services",
    "travail mission missions activite activites entreprise societe assurer participation",
    "participer realisation realiser organisation organiser coordination animation",
    "encadrement reporting analyse amelioration preparation controle relation relations",
    "developpement interne externe ensemble differents differentes nouveaux nouvelles",
    "charge cadre aupres afin selon niveau qualite besoins besoin",
    "management team teams customer customers project projects work business support",
  ]
    .join(" ")
    .split(" "),
);

/** Poids d'un terme générique (`GENERIC_TERMS`) face à un terme métier (1). */
export const GENERIC_TERM_WEIGHT = 0.25;

export type WeightedTerm = { term: string; weight: number };

/**
 * Termes significatifs d'un texte (normalisés, sans doublons ni mots vides),
 * pondérés : 1 pour un terme métier, `GENERIC_TERM_WEIGHT` pour un terme
 * générique. « c++ », « c# » ou « node.js » restent entiers.
 * `common: false` écarte aussi les termes génériques et les mots courants
 * du travail (texte libre, comme des responsabilités).
 */
export function significantTerms(text: string, options: { common?: boolean } = {}): WeightedTerm[] {
  const keepCommon = options.common ?? true;
  const seen = new Set<string>();
  const terms: WeightedTerm[] = [];
  for (const raw of normalizeText(text).split(/[^\p{L}\p{N}+#.]+/u)) {
    const term = raw.replace(/^\.+|\.+$/g, "");
    if (term.length < 2 || /^[\d.]+$/.test(term) || STOP_WORDS.has(term) || seen.has(term)) {
      continue;
    }
    const generic = GENERIC_TERMS.has(term);
    if (!keepCommon && (generic || COMMON_WORK_TERMS.has(term) || term.length < 4)) continue;
    seen.add(term);
    terms.push({ term, weight: generic ? GENERIC_TERM_WEIGHT : 1 });
  }
  return terms;
}

/** Phrases ou lignes d'un texte (puces et retours à la ligne compris). */
export function sentences(text: string): string[] {
  return text
    .split(/\r?\n|(?<=[.!?;])\s+|\s[•·▪●◦*-]\s/)
    .map((s) => s.replace(/^[\s•·▪●◦*–-]+/, "").trim())
    .filter((s) => s.length >= 3);
}

/** Coupe un texte à `max` caractères sur une limite de mot. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = truncateSafe(clean, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}
