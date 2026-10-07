/**
 * `npm run i18n:check` — vérifie que toutes les langues ont exactement les
 * mêmes clés que le français et des messages ICU cohérents. Code de sortie 1
 * en cas de problème (utilisé en CI).
 */
import { checkMessages } from "../src/i18n/check-messages";
import { MESSAGES } from "../src/i18n/messages";
import { DEFAULT_LOCALE, LOCALES } from "../src/i18n/routing";

const others = Object.fromEntries(
  LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => [l, MESSAGES[l]]),
);
const problems = checkMessages(MESSAGES[DEFAULT_LOCALE], others);

if (problems.length > 0) {
  console.error(`${problems.length} problème(s) dans messages/ :`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Traductions cohérentes : ${LOCALES.join(", ")}.`);
