import type { AppLocale } from "@/i18n/routing";

/**
 * Langue d'une offre, parmi les six langues de l'application, d'après ses
 * mots-outils les plus fréquents (sans IA). Sert à rédiger le message dans la
 * langue de l'offre.
 */

const STOP_WORDS: Record<AppLocale, string[]> = {
  fr: "le la les des du une est et pour dans vous nous avec sur votre nos au aux ce qui que en être sera poste équipe".split(
    " ",
  ),
  en: "the and you are with our for will your this that have from team role we an as be".split(" "),
  es: "el los las del una con para por que es nuestro equipo usted puesto se su como más".split(
    " ",
  ),
  it: "il gli della delle con per che una sono nel nella del nostro ruolo essere sarà".split(" "),
  de: "der die das und mit für ist wir sie ein eine den dem zu auf bei unser stelle wird".split(
    " ",
  ),
  nl: "het een van voor met zijn wij jij je ons onze bij op als functie wordt".split(" "),
};

const WORD_SETS = Object.fromEntries(
  Object.entries(STOP_WORDS).map(([locale, words]) => [locale, new Set(words)]),
) as Record<AppLocale, Set<string>>;

/** Langue la plus probable, ou `null` si le texte est trop court ou ambigu. */
export function detectLanguage(text: string): AppLocale | null {
  const words = text
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .slice(0, 600);
  const scores = (Object.keys(WORD_SETS) as AppLocale[])
    .map((locale) => ({
      locale,
      score: words.reduce((n, w) => n + (WORD_SETS[locale].has(w) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (!best || best.score < 3) return null;
  // Écart net exigé : un texte bilingue garde la langue de repli.
  return best.score >= (second?.score ?? 0) * 1.3 ? best.locale : null;
}

/**
 * Langue du message pour une offre : détectée dans l'intitulé et le texte ;
 * à défaut, français pour France Travail et les offres situées en France,
 * anglais sinon.
 */
export function offerLanguage(offer: {
  title: string;
  description: string;
  source: string;
  country: string | null;
}): AppLocale {
  const detected = detectLanguage(`${offer.title}\n${offer.description}`);
  if (detected) return detected;
  return offer.source === "france_travail" || offer.country === "FR" || !offer.country
    ? "fr"
    : "en";
}
