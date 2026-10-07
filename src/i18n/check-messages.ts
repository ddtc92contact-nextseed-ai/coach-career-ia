import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";

/**
 * Contrôle des fichiers de traduction (`messages/<langue>.json`), utilisé par
 * `npm run i18n:check` et par la suite de tests (donc par la CI) :
 * - mêmes clés dans toutes les langues que dans le français (source) ;
 * - chaque message est un ICU MessageFormat valide ;
 * - mêmes variables (`{count}`, `{date}`…) et mêmes balises (`<link>`) que le
 *   message français.
 */

type Catalog = { [key: string]: string | Catalog };

export function flattenMessages(catalog: Catalog, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(path, value);
    else for (const [k, v] of flattenMessages(value, path)) result.set(k, v);
  }
  return result;
}

function collectArguments(elements: MessageFormatElement[], into: Set<string>): Set<string> {
  for (const element of elements) {
    switch (element.type) {
      case TYPE.argument:
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        into.add(element.value);
        break;
      case TYPE.plural:
      case TYPE.select:
        into.add(element.value);
        for (const option of Object.values(element.options)) collectArguments(option.value, into);
        break;
      case TYPE.tag:
        into.add(`<${element.value}>`);
        collectArguments(element.children, into);
        break;
      default:
        break;
    }
  }
  return into;
}

export function messageArguments(message: string): Set<string> {
  return collectArguments(parse(message), new Set());
}

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((value) => b.has(value));

/** Liste des problèmes (vide si tout est cohérent). */
export function checkMessages(source: Catalog, locales: Record<string, Catalog>): string[] {
  const problems: string[] = [];
  const reference = flattenMessages(source);
  const referenceArgs = new Map<string, Set<string>>();
  for (const [key, message] of reference) {
    try {
      referenceArgs.set(key, messageArguments(message));
    } catch {
      problems.push(`source : message ICU invalide pour « ${key} »`);
    }
  }

  for (const [locale, catalog] of Object.entries(locales)) {
    const messages = flattenMessages(catalog);
    for (const key of reference.keys()) {
      if (!messages.has(key)) problems.push(`${locale} : clé manquante « ${key} »`);
    }
    for (const [key, message] of messages) {
      if (!reference.has(key)) {
        problems.push(`${locale} : clé absente du français « ${key} »`);
        continue;
      }
      let args: Set<string>;
      try {
        args = messageArguments(message);
      } catch {
        problems.push(`${locale} : message ICU invalide pour « ${key} »`);
        continue;
      }
      const expected = referenceArgs.get(key);
      if (expected && !sameSet(args, expected)) {
        problems.push(
          `${locale} : variables différentes pour « ${key} » (${[...args].join(", ")} au lieu de ${[...expected].join(", ")})`,
        );
      }
      if (message.trim() === "") problems.push(`${locale} : message vide pour « ${key} »`);
    }
  }
  return problems;
}
