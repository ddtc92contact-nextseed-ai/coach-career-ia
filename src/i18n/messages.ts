import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import it from "../../messages/it.json";
import nl from "../../messages/nl.json";
import type { AppLocale } from "./routing";

/** Le français est la source : les autres fichiers doivent avoir les mêmes clés. */
export type Messages = typeof fr;

export const MESSAGES: Record<AppLocale, Messages> = { fr, en, es, it, de, nl };
