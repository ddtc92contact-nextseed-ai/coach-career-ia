import { identityTerms, isIdentityUrl, redactText } from "@/lib/import/pseudonymise";
import type { SuggestionData, SuggestionKind } from "./shared";

/**
 * Pseudonymisation des suggestions du coach, déterministe (indépendante du
 * modèle) : avant qu'une suggestion soit stockée, ses textes perdent
 * - les e-mails, téléphones et liens ;
 * - les termes identifiants connus : parties de l'adresse e-mail du compte,
 *   entreprises exclues (garde-fous), et noms signalés par le modèle
 *   (`identifyingTerms`).
 * Un lien de preuve qui désigne un profil personnel (LinkedIn…) est retiré.
 */

export type RedactionContext = {
  /** Termes connus pour ce candidat (`coachIdentityTerms`). */
  knownTerms: string[];
  /** Noms signalés par le modèle pour cette suggestion. */
  declaredTerms?: string[];
};

/** Parties du nom du compte (`jeanne.testard@…` → `jeanne`, `testard`). */
export function emailNameParts(email: string): string[] {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[^\p{L}]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

export function buildTerms(context: RedactionContext): string[] {
  const declared = (context.declaredTerms ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && term.length <= 120)
    .slice(0, 30);
  return identityTerms({ people: [], names: [...context.knownTerms, ...declared] });
}

function clean(text: string, terms: string[]) {
  return redactText(text, terms);
}

/** Texte libre pseudonymisé (justification d'une suggestion…). */
export function redactPlain(text: string, context: RedactionContext): string {
  return text ? clean(text, buildTerms(context)).text : text;
}

/** Version pseudonymisée des données d'une suggestion, et si quelque chose a été retiré. */
export function redactSuggestion<K extends SuggestionKind>(
  kind: K,
  data: SuggestionData[K],
  context: RedactionContext,
): { data: SuggestionData[K]; changed: boolean } {
  const terms = buildTerms(context);
  let changed = false;
  const text = (value: string) => {
    if (!value) return value;
    const result = clean(value, terms);
    if (result.changed) changed = true;
    return result.text;
  };

  switch (kind) {
    case "ACHIEVEMENT": {
      const d = data as SuggestionData["ACHIEVEMENT"];
      let proofUrl = d.proofUrl;
      if (proofUrl && isIdentityUrl(proofUrl)) {
        proofUrl = undefined;
        changed = true;
      }
      const next: SuggestionData["ACHIEVEMENT"] = {
        ...d,
        title: text(d.title),
        context: text(d.context),
        actions: text(d.actions),
        result: text(d.result),
        skills: d.skills.map(text).filter((s) => s && s !== "[…]"),
        proofUrl,
      };
      return { data: next as SuggestionData[K], changed };
    }
    case "EXPERIENCE_UPDATE": {
      const d = data as SuggestionData["EXPERIENCE_UPDATE"];
      const changes = { ...d.changes };
      if (changes.roleTitle !== undefined) changes.roleTitle = text(changes.roleTitle);
      if (changes.responsibilities !== undefined) {
        changes.responsibilities = text(changes.responsibilities);
      }
      return { data: { ...d, changes } as SuggestionData[K], changed };
    }
    case "SKILL": {
      const d = data as SuggestionData["SKILL"];
      return { data: { name: text(d.name) } as SuggestionData[K], changed };
    }
    case "GUARD_RAIL": {
      const d = data as SuggestionData["GUARD_RAIL"];
      const locations = d.locations?.map((l) => ({ ...l, label: text(l.label) }));
      return { data: { ...d, ...(locations ? { locations } : {}) } as SuggestionData[K], changed };
    }
  }
  return { data, changed };
}
