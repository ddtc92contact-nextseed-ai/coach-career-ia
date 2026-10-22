/**
 * Troncature sans casser un caractère (issue #71).
 *
 * `String.prototype.slice` compte en unités UTF-16 : un émoji (caractère
 * astral) en occupe deux, une paire de substitution. Couper entre les deux
 * laisse une première moitié isolée, que `JSON.stringify` écrit `\ud83d` et que
 * l'API Mistral rejette (400 « Invalid JSON payload »).
 *
 * `truncateSafe` ne copie que le début du texte (jamais le texte entier, ni
 * `Array.from` : issue #64) et, à la limite près, rend exactement ce que
 * rendrait `slice` : l'empreinte des textes déjà embarqués ne change pas.
 */

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Début de `text`, `maxUnits` unités UTF-16 au plus, sans moitié de paire finale. */
export function truncateSafe(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text;
  if (maxUnits <= 0) return "";
  const end = isHighSurrogate(text.charCodeAt(maxUnits - 1)) ? maxUnits - 1 : maxUnits;
  return text.slice(0, end);
}
