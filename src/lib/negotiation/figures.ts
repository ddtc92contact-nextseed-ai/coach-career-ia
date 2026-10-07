import type { ContractTypeCode } from "@/lib/career/codes";

/**
 * Lecture déterministe (sans IA) des éléments chiffrés d'un message de
 * négociation, dans les six langues de l'application : montants, jours de
 * télétravail, type de contrat, mentions d'offre concurrente ou de salaire
 * actuel. Sert à la fois au contrôle des brouillons (blocage) et à l'analyse
 * de la proposition de l'entreprise (estimation).
 *
 * Volontairement prudent : un montant n'est reconnu que s'il porte une devise,
 * un « k », ou des séparateurs de milliers (une année ou un code postal ne
 * sont pas des montants).
 */

export type Amount = {
  /** Valeur lue, en euros. */
  value: number;
  /** Période déduite du contexte. */
  period: "year" | "month" | "day" | "hour" | "unknown";
  /** Équivalent annuel (mois × 12) ; `null` pour un taux journalier ou horaire. */
  annual: number | null;
  raw: string;
};

const SEP = "[\\s\\u00a0\\u202f.,'’]";
const NUMBER = `\\d{1,3}(?:${SEP}\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?`;
const CURRENCY = "€|eur(?:os?)?\\b|euros?\\b";
const AMOUNT = new RegExp(
  `(€\\s?|eur\\s)?(${NUMBER})\\s?(k\\s?(?:${CURRENCY})?|${CURRENCY})?`,
  "giu",
);
/** « 55-60k », « 55 à 60 k€ » : le « k » vaut pour les deux bornes. */
const K_RANGE = /(\d{2,3})\s?(?:-|–|à|to|a|bis|tot|al)\s?(\d{2,3})\s?k/giu;

const MONTH =
  /^\s*(?:brut\w*|gross|bruto|lordo|brutto)?\s*(?:\/|par|per|pro|al|a|by|im|in|each)?\s*(?:mois|month|mes|mese|monat|maand)|^\s*(?:brut\w*\s*)?(?:mensuels?|monthly|mensual(?:es)?|mensil[ei]|monatlich|maandelijks)/iu;
const DAY = /^\s*(?:ht\s*)?(?:\/|par|per|pro|al|a|by)\s*(?:jour|day|día|dia|giorno|tag|dag)/iu;
const HOUR =
  /^\s*(?:brut\w*\s*)?(?:\/|par|per|pro|al|a|by)?\s*(?:heure|hour|hora|ora|stunde|uur|h)\b/iu;

function parseNumber(raw: string): number {
  const compact = raw.replace(/[\s  ]/g, "");
  // Séparateurs de milliers (« 55.000 », « 55,000 », « 55 000 ») : tous retirés,
  // sauf une éventuelle partie décimale finale à un ou deux chiffres.
  const grouped = new RegExp(`^\\d{1,3}(?:${SEP}\\d{3})+`, "u").test(raw);
  if (grouped) {
    const decimal = /[.,](\d{1,2})$/.exec(compact);
    const integer = (decimal ? compact.slice(0, decimal.index) : compact).replace(/[.,'’]/g, "");
    return Number(integer) + (decimal ? Number(`0.${decimal[1]}`) : 0);
  }
  return Number(compact.replace(",", "."));
}

/** Montants du texte, dans l'ordre. */
export function findAmounts(text: string): Amount[] {
  const source = text.replace(K_RANGE, "$1k – $2k");
  const amounts: Amount[] = [];
  for (const match of source.matchAll(AMOUNT)) {
    const [raw, prefix, number, suffix] = match;
    if (!number) continue;
    const hasK = /^k/i.test(suffix ?? "");
    const hasCurrency = Boolean(prefix) || Boolean(suffix && !/^k$/i.test(suffix.trim()));
    const grouped = new RegExp(`^\\d{1,3}(?:${SEP}\\d{3})+`, "u").test(number);
    if (!hasK && !hasCurrency && !grouped) continue;
    // « 2 000 3 » ou une date « 12.10.2026 » : pas un montant.
    if (!hasK && !hasCurrency && /\d[.,]\d{2}[.,]\d{2,4}/.test(number)) continue;
    const value = parseNumber(number) * (hasK ? 1000 : 1);
    if (!Number.isFinite(value) || value <= 0) continue;
    const after = source.slice(
      (match.index ?? 0) + raw.length,
      (match.index ?? 0) + raw.length + 30,
    );
    let period: Amount["period"] = "unknown";
    if (MONTH.test(after)) period = "month";
    else if (DAY.test(after)) period = "day";
    else if (HOUR.test(after)) period = "hour";
    else if (
      /^\s*(?:brut\w*\s*)?(?:\/|par|per|pro|al|a)\s*(?:an|year|año|anno|jahr|jaar)\b|^\s*(?:annuel|yearly|annual|anual|annuo|jährlich|jaarlijks)/iu.test(
        after,
      )
    )
      period = "year";
    const annual =
      period === "month" ? value * 12 : period === "day" || period === "hour" ? null : value;
    amounts.push({ value, period, annual, raw: raw.trim() });
  }
  return amounts;
}

/** Montants plausibles pour une rémunération annuelle (10 k€ à 1 M€). */
export function salaryAmounts(text: string): number[] {
  return findAmounts(text)
    .map((a) => a.annual)
    .filter((v): v is number => v !== null && v >= 10_000 && v <= 1_000_000);
}

export function findPercentages(text: string): number[] {
  return [...text.matchAll(/(\d+(?:[.,]\d+)?)\s?%/gu)].map((m) => Number(m[1]!.replace(",", ".")));
}

// --- Phrases et négation ---------------------------------------------------------------

/** Découpe en phrases (et en lignes : les listes à puces sont des phrases). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const NEGATION =
  /(?:^|[^\p{L}])(?:ne|n['’]|pas|non|not|no|never|jamais|aucun\w*|sans|without|kein\w*|nicht|niet|geen|nunca|sin|nessun\w*|senza|ohne|zonder)(?:$|[^\p{L}])|n['’]t\b/iu;

export function isNegated(sentence: string): boolean {
  return NEGATION.test(sentence);
}

// --- Télétravail ---------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  zéro: 0,
  un: 1,
  une: 1,
  one: 1,
  uno: 1,
  una: 1,
  ein: 1,
  eine: 1,
  einen: 1,
  een: 1,
  deux: 2,
  two: 2,
  dos: 2,
  due: 2,
  zwei: 2,
  twee: 2,
  trois: 3,
  three: 3,
  tres: 3,
  tre: 3,
  drei: 3,
  drie: 3,
  quatre: 4,
  four: 4,
  cuatro: 4,
  quattro: 4,
  vier: 4,
  cinq: 5,
  five: 5,
  cinco: 5,
  cinque: 5,
  fünf: 5,
  vijf: 5,
};
const COUNT = `(?<![\\p{L}\\d])(\\d|${Object.keys(NUMBER_WORDS).join("|")})`;
const DAYS = "(?:jours?|days?|días?|dias?|giorn[oi]|tage?n?|dagen?)";
const REMOTE =
  "(?:t[ée]l[ée]travail|remote|home[- ]?office|teletrabajo|smart[- ]working|lavoro da remoto|thuiswerk\\w*|telewerk\\w*|à distance|a distanza|en remoto|da remoto)";
/** « un seul jour », « a single day », « un solo día »… */
const ONLY = "(?:seule?|single|solo|sol[oa]|einzigen?|enkele)\\s";
const REMOTE_DAYS = [
  new RegExp(`${COUNT}\\s?(?:${ONLY})?${DAYS}\\s(?:\\S+\\s){0,4}?${REMOTE}`, "iu"),
  new RegExp(`${REMOTE}\\s(?:\\S+\\s){0,3}?${COUNT}\\s?${DAYS}`, "iu"),
];
const FULL_REMOTE =
  /full[- ]?remote|100\s?%\s?(?:t[ée]l[ée]travail|remote|à distance)|enti[èe]rement (?:à distance|en t[ée]l[ée]travail)|fully remote|vollständig remote|completamente (?:da remoto|en remoto)|volledig (?:op afstand|thuis)/iu;
const NO_REMOTE = new RegExp(
  [
    "100\\s?%\\s?(?:pr[ée]sentiel|on[- ]?site|sur site|vor ort|in sede|presencial|op kantoor)",
    // « pas de télétravail », « sans télétravail », « no remote », « kein Homeoffice »…
    `(?<![\\p{L}])(?:pas de|pas d['’]|sans|aucun\\w*|z[ée]ro|no|without|kein\\w*|ohne|sin|nada de|nessun\\w*|senza|niente|geen|zonder)\\s(?:\\S+\\s)?${REMOTE}`,
    "fully on[- ]?site|full[- ]time on[- ]?site|on[- ]?site full[- ]time|sur site uniquement",
    "(?:sur site|en pr[ée]sentiel|pr[ée]sentiel|au bureau) (?:à|a) temps (?:plein|complet)",
    "(?:5|cinq|five) (?:jours|days) (?:sur site|au bureau|en pr[ée]sentiel|on[- ]?site|in the office)",
  ].join("|"),
  "iu",
);
/**
 * Rappel d'un minimum (« au moins 2 jours », « pas moins de 2 jours », « not
 * fewer than ») : la seule forme où une négation ne vaut pas concession.
 */
const AT_LEAST =
  /au moins|pas moins d|minimum|at least|no (?:fewer|less) than|not (?:fewer|less) than|mindestens|nicht weniger als|al menos|no menos de|almeno|non meno di|minstens|niet minder dan|ten minste/iu;

function countedRemoteDays(sentence: string): number | null {
  for (const pattern of REMOTE_DAYS) {
    const m = pattern.exec(sentence);
    if (m) {
      const word = m[1]!.toLowerCase();
      const n = /^\d$/.test(word) ? Number(word) : NUMBER_WORDS[word];
      if (n !== undefined && n <= 5) return n;
    }
  }
  return null;
}

/** Jours de télétravail hebdomadaires mentionnés dans une phrase, ou `null`. */
export function remoteDaysIn(sentence: string): number | null {
  // « au moins 2 jours de télétravail » : le minimum rappelé fait foi.
  if (AT_LEAST.test(sentence)) {
    const n = countedRemoteDays(sentence);
    if (n !== null) return n;
  }
  if (NO_REMOTE.test(sentence)) return 0;
  if (FULL_REMOTE.test(sentence)) return 5;
  return countedRemoteDays(sentence);
}

// --- Contrat -------------------------------------------------------------------------

const CONTRACT_PATTERNS: Record<ContractTypeCode, RegExp> = {
  CDI: /\bCDI\b|permanent (?:contract|position|role)|dur[ée]e ind[ée]termin[ée]e|unbefristet|contrato indefinido|tempo indeterminato|vast contract|onbepaalde tijd/iu,
  CDD: /\bCDD\b|fixed[- ]term|dur[ée]e d[ée]termin[ée]e|\bbefristet|contrato temporal|tempo determinato|bepaalde tijd|tijdelijk contract/iu,
  FREELANCE:
    /freelance|ind[ée]pendant|portage salarial|contractor|aut[óo]nomo|freiberuf\w*|libero professionista|\bzzp\b/iu,
  TEMPORARY:
    /int[ée]rim|temp(?:orary)? agency|temporary\s*\/\s*agency|leiharbeit|zeitarbeit|uitzend\w*|somministrazione|interinale|\bETT\b/iu,
  APPRENTICESHIP:
    /alternance|apprentissage|apprenticeship|ausbildung|apprendistato|aprendizaje|formaci[óo]n dual|leer-?werk\w*/iu,
  INTERNSHIP:
    /\bstage (?:de|d['’]|conventionn)|\b(?:un|een|contrat|contract)\s+stage\b|stagiaire|internship|\bintern\b|praktikum|tirocinio|pr[áa]cticas|becari[oa]/iu,
};

/** Types de contrat mentionnés dans un texte. */
export function contractsIn(text: string): ContractTypeCode[] {
  return (Object.keys(CONTRACT_PATTERNS) as ContractTypeCode[]).filter((code) =>
    CONTRACT_PATTERNS[code].test(text),
  );
}

/**
 * Négation ou refus juste avant le type de contrat, à deux mots près :
 * « pas de CDD », « ni intérim », « refuse un CDD », « non un CDI ».
 */
const NEGATED_BEFORE =
  /(?:^|[^\p{L}])(?:pas|non|ni|no|not|nor|never|jamais|aucun\w*|sans|without|kein\w*|nicht|weder|noch|ohne|sin|nunca|nessun\w*|senza|né|niet|geen|zonder|refuse\w*|exclu\w*|rejet\w*|reject\w*|declin\w*|rechaz\w*|rifiut\w*|weiger\w*)(?:\s+|\s*[dl]['’])(?:[\p{L}'’]+\s+){0,2}$/iu;

/** Chaque mention du type de contrat dans la phrase : niée (`true`) ou non. */
export function contractNegations(sentence: string, code: ContractTypeCode): boolean[] {
  const pattern = new RegExp(CONTRACT_PATTERNS[code].source, "giu");
  return [...sentence.matchAll(pattern)].map((m) =>
    NEGATED_BEFORE.test(sentence.slice(Math.max(0, m.index - 40), m.index)),
  );
}

// --- Faits non fournis -----------------------------------------------------------------

/** Mention d'une offre concurrente (ou d'une autre proposition reçue). */
const COMPETING_OFFER =
  /autres? (?:offre|proposition)s?|offres? concurrente|proposition concurrente|autre entreprise (?:lui )?(?:propose|offre)|(?:another|other|competing|rival) (?:offer|proposal)|offer from another|otras? ofertas?|oferta (?:competidora|de otra)|altr[ae] offert[ae]|offerta concorrente|(?:anderes|weiteres|konkurrierendes) angebot|konkurrenzangebot|angebot (?:eines|einer) anderen|(?:ander|concurrerend) (?:aanbod|bod)|andere aanbieding|(?:another|other) (?:company|employer|firm)|(?:has|have|got|received) (?:an?|another) (?:\p{L}+ )?offer\b|autre (?:entreprise|soci[ée]t[ée]|employeur)|(?:a|ont|avons) re[çc]u une (?:\p{L}+ )?(?:offre|proposition)|dispose d['’]une (?:\p{L}+ )?offre|otra (?:empresa|compañía)|ha recibido una (?:\p{L}+ )?oferta|altra (?:azienda|società)|ha ricevuto un['’ ]\s?(?:\p{L}+ )?offerta|(?:anderes|anderen) unternehmen|andere firma|hat ein (?:\p{L}+ )?angebot (?:erhalten|bekommen)|(?:ander|een ander) bedrijf|andere werkgever|heeft een (?:\p{L}+ )?(?:aanbod|bod) (?:gekregen|ontvangen)/iu;
/**
 * Repère du marché présenté comme tel : « offres publiées », « published
 * offers »… (six langues). Exigé autour d'un chiffre qui ne vient que du repère.
 */
export const PUBLISHED_OFFERS = /publi(?:é|e|s|cad|cat)|pubblicat|ver[öo]ffentlicht|gepubliceerd/iu;

/**
 * Statistique du repère (« médiane », « quartile », « p75 »…, six langues) :
 * un chiffre du repère n'est cité que sous cette forme, jamais comme un montant
 * isolé que l'on pourrait prendre pour une offre.
 */
export const BENCHMARK_STATISTIC =
  /m[ée]dian|mediaan|quarti[lt]|kwartiel|(?<![\p{L}\d])p(?:25|50|75)(?![\p{L}\d])|percentil|perzentil|centile/iu;

/**
 * Offre faite à quelqu'un (verbe d'offre, « offer of »…) ou tiers qui la ferait
 * (concurrent, recruteur, « ailleurs »…), six langues. Interdit dans une phrase
 * qui cite un chiffre du repère : le repère n'est jamais une offre reçue.
 */
const OFFER_TO_SOMEONE =
  /(?<!\p{L})(?:propos(?:é|e|ait|era|i|ition|ta|to|te|ti)|propuest[oa]|offerts?(?!\p{L})|offert[oa](?!\p{L})|offered|offering|offers? (?:of|at|to|her|him|them)(?!\p{L})|ofrec|oferta (?:de|a|por)(?!\p{L})|ha offerto|offre (?:a|al|alla|le|gli)(?!\p{L})|lui offre|angeboten|anbiet|bietet|geboten|angebot (?:von|über|in höhe)|aangeboden|biedt|geboden|(?:bod|aanbod) van|concurren|competitor|competidor|concorrent|konkurren|recrut|recruit|reclut|headhunt|chasseur|cazatalent|cacciator|selezionator|personalvermittl|ailleurs|elsewhere|en otr[oa] (?:lugar|sitio|parte)|altrove|anderswo|woanders|elders|ergens anders|(?:lui|her|him|ihm|ihr|haar|hem)(?!\p{L}))/iu;

/** Mots admis entre la statistique et le montant (« médiane de », « p75 of »…). */
const STAT_TO_AMOUNT =
  /^\p{L}*\.?(?:\s+(?:de|d['’]|des|du|of|von|van|di|del|della|da|at|à|est|is|ist|è|es|ligt|liegt|op|bei|around|about|environ|rund|circa|ongeveer|alrededor|intorno|haut|bas|supérieur|inférieur|upper|lower|obere|untere|bovenste|onderste|superior|inferior|superiore|inferiore))*\s*(?:€\s?)?$/iu;

/**
 * Vocabulaire fermé des propositions qui citent le repère, dans les six
 * langues : articles, compléments de poste/lieu, verbes d'affichage,
 * statistiques, unités. Aucun pronom, aucun verbe d'action (signer,
 * garantir, recevoir…), aucune conjonction (mais, car, but, since…).
 */
const BENCHMARK_VOCABULARY = new Set(
  // fr
  (
    "les le la l des de du d un une ce cette ces pour dans même mêmes postes poste similaires " +
    "comparables métier zone région pays offres annonces affichent montrent indiquent révèlent " +
    "situent est se premier première troisième brut brute annuel annuelle annuels par an et " +
    // en
    "the a an for in this these similar comparable roles role positions jobs occupation area " +
    "region country offers postings show indicate is first third gross per year annual and of " +
    // es
    "las los el una para en esta este estos puestos puesto similares oficio zona región país " +
    "ofertas muestran indican primer tercer brutos bruto anuales anual al año y " +
    // it
    "le il lo gli una un per in questa questo ruoli ruolo simili mestiere zona regione paese " +
    "offerte annunci indicano mostrano primo terzo lordi lordo annui annuo all anno e di " +
    // de
    "die der das den dem ein eine einen für in dieser diesem diesen vergleichbare vergleichbaren " +
    "stellen stelle beruf region land angebote stellenangebote zeigen weisen aus liegt bei " +
    "ersten dritten erste dritte brutto pro jahr jährlich und von im " +
    // nl
    "de het een voor in deze dit vergelijkbare functies functie beroep regio land vacatures " +
    "tonen laten zien eerste derde bruto per jaar jaarlijks en van op"
  ).split(" "),
);

function isBenchmarkToken(token: string): boolean {
  const word = token.replace(/^[(«"“]+|[.,;)»"”!?]+$/gu, "").toLowerCase();
  if (word === "" || /\d/u.test(word) || /^(?:€|k|k€|eur|euros?)$/u.test(word)) return true;
  if (BENCHMARK_STATISTIC.test(word) || PUBLISHED_OFFERS.test(word)) return true;
  return word
    .split(/['’-]/u)
    .filter(Boolean)
    .every((part) => BENCHMARK_VOCABULARY.has(part));
}

/**
 * Liste blanche : le montant `raw` est-il cité EXACTEMENT comme le modèle cite
 * le repère ? Dans sa proposition (`;`, `:` ou tiret séparent) :
 * - chaque mot appartient au vocabulaire fermé du repère (`BENCHMARK_VOCABULARY`) ;
 * - « offres publiées » précède le montant ;
 * - le montant suit immédiatement une statistique (« médiane de X », « p75 of X »)
 *   ou la porte entre parenthèses (« X (p25) »).
 * Toute autre forme est refusée : un faux refus ne coûte qu'un retour au modèle.
 */
export function framesBenchmark(sentence: string, raw: string): boolean {
  for (const clause of sentence.split(/\s*(?:[:;—–]|\s-\s)\s*/u)) {
    const at = clause.indexOf(raw);
    if (at < 0) continue;
    if (!clause.split(/\s+/u).every(isBenchmarkToken)) return false;
    const published = PUBLISHED_OFFERS.exec(clause);
    if (!published || published.index > at) return false;
    const between = clause.slice(published.index, at);
    const stat = new RegExp(BENCHMARK_STATISTIC.source, "giu");
    for (const m of between.matchAll(stat)) {
      if (STAT_TO_AMOUNT.test(between.slice(m.index + m[0].length))) return true;
    }
    const parenthesized = new RegExp(
      `^\\s*(?:€\\s?)?\\(\\s*(?:${BENCHMARK_STATISTIC.source})`,
      "iu",
    );
    return parenthesized.test(clause.slice(at + raw.length));
  }
  return false;
}

/** La phrase présente-t-elle un chiffre comme une offre faite au candidat ou par un tiers ? */
export function mentionsOfferToSomeone(sentence: string): boolean {
  return OFFER_TO_SOMEONE.test(sentence);
}

/** La phrase évoque-t-elle une offre reçue, ou faite par une autre entreprise ? */
export function mentionsCompetingOffer(sentence: string): boolean {
  return COMPETING_OFFER.test(sentence);
}
/** Mention du salaire actuel ou passé du candidat. */
const CURRENT_SALARY =
  /(?:salaire|r[ée]mun[ée]ration|paie) (?:actuel(?:le)?|pr[ée]c[ée]dent(?:e)?)|actuellement (?:pay[ée]e?|r[ée]mun[ée]r[ée]e?)|gagne actuellement|(?:current|present|previous) (?:salary|pay|compensation)|currently (?:earns?|paid|makes?)|(?:salario|sueldo) actual|(?:stipendio|retribuzione) attuale|attualmente (?:guadagna|percepisce)|(?:aktuelles?|derzeitiges?|jetziges?) gehalt|verdient (?:derzeit|aktuell)|huidig(?:e)? salaris|verdient (?:nu|momenteel)/iu;

export type ClaimCode = "competingOffer" | "currentSalary";

/** Affirmations de fait sensibles (hors phrases négatives). */
export function claimsIn(text: string): ClaimCode[] {
  const found = new Set<ClaimCode>();
  for (const sentence of sentences(text)) {
    if (COMPETING_OFFER.test(sentence) && !isNegated(sentence)) found.add("competingOffer");
    if (CURRENT_SALARY.test(sentence) && !isNegated(sentence)) found.add("currentSalary");
  }
  return [...found];
}

/** Le texte (faits déclarés par le candidat) évoque-t-il ce type de fait ? */
export function mentionsClaim(text: string, claim: ClaimCode): boolean {
  return (claim === "competingOffer" ? COMPETING_OFFER : CURRENT_SALARY).test(text);
}
