import {
  claimsIn,
  contractNegations,
  contractsIn,
  findAmounts,
  findPercentages,
  mentionsClaim,
  remoteDaysIn,
  salaryAmounts,
  sentences,
} from "./figures";
import type { Mandate } from "./mandate";

/**
 * Contrôle déterministe d'un message sortant au regard du mandat. Un problème
 * BLOQUE l'approbation et l'envoi (jamais un simple avertissement) :
 * - `belowFloor` : un montant de rémunération sous le plancher ;
 * - `remoteDays` / `contractType` : un point non négociable concédé ;
 * - `competingOffer` / `currentSalary` : un fait que le candidat n'a pas
 *   déclaré dans son mandat (pas de bluff : bonne foi précontractuelle,
 *   art. 1112 du Code civil) ;
 * - `inventedFigure` (texte rédigé par l'IA seulement) : un chiffre qui ne
 *   vient ni du mandat, ni de l'offre, ni des messages de l'entreprise.
 *
 * Module pur, partagé par le serveur et les tests.
 */

export const NEGOTIATION_ISSUES = [
  "belowFloor",
  "remoteDays",
  "contractType",
  "competingOffer",
  "currentSalary",
  "inventedFigure",
] as const;
export type NegotiationIssueCode = (typeof NEGOTIATION_ISSUES)[number];
export type NegotiationIssue = { code: NegotiationIssueCode; excerpt?: string };

export type AllowedFigures = { amounts: number[]; percentages: number[] };

/** Chiffres que l'agent peut reprendre : mandat, offre, messages de l'entreprise. */
export function allowedFigures(
  mandate: Mandate,
  sources: string[],
  extraAmounts: (number | null | undefined)[] = [],
): AllowedFigures {
  const texts = [
    mandate.facts ?? "",
    mandate.location ?? "",
    mandate.title ?? "",
    ...mandate.otherPoints,
    ...mandate.niceToHave,
    ...sources,
  ];
  const amounts = new Set<number>([mandate.salaryFloor]);
  if (mandate.salaryTarget !== null) amounts.add(mandate.salaryTarget);
  for (const v of extraAmounts) if (typeof v === "number" && v > 0) amounts.add(v);
  const percentages = new Set<number>();
  for (const text of texts) {
    for (const a of findAmounts(text)) {
      amounts.add(a.value);
      if (a.annual !== null) amounts.add(a.annual);
    }
    for (const p of findPercentages(text)) percentages.add(p);
  }
  return { amounts: [...amounts], percentages: [...percentages] };
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.005);

export function checkOutgoing(
  text: string,
  mandate: Mandate,
  options: { allowed?: AllowedFigures } = {},
): NegotiationIssue[] {
  const issues: NegotiationIssue[] = [];
  const push = (code: NegotiationIssueCode, excerpt?: string) => {
    if (!issues.some((i) => i.code === code)) {
      issues.push({ code, ...(excerpt ? { excerpt: excerpt.trim().slice(0, 80) } : {}) });
    }
  };

  // Plancher : aucun montant annuel inférieur, même cité ou nié.
  const below = findAmounts(text).find(
    (a) =>
      a.annual !== null &&
      a.annual >= 10_000 &&
      a.annual <= 1_000_000 &&
      a.annual < mandate.salaryFloor,
  );
  if (below) push("belowFloor", below.raw);

  // Points non négociables : une phrase négative n'est PAS exemptée (« accepte
  // qu'il n'y ait pas de télétravail », « un CDD et non un CDI » concèdent).
  // Seuls le rappel d'un minimum et le refus explicite d'un autre contrat passent.
  for (const sentence of sentences(text)) {
    if (mandate.remoteDaysMin !== null) {
      const days = remoteDaysIn(sentence);
      if (days !== null && days < mandate.remoteDaysMin) push("remoteDays", sentence);
    }
    const required = mandate.contractType;
    if (required) {
      // Un autre contrat cité sans être refusé, ou le contrat exigé nié.
      const conceded =
        contractsIn(sentence).some(
          (c) => c !== required && contractNegations(sentence, c).some((negated) => !negated),
        ) || contractNegations(sentence, required).some(Boolean);
      if (conceded) push("contractType", sentence);
    }
  }

  for (const claim of claimsIn(text)) {
    if (!mentionsClaim(mandate.facts ?? "", claim)) push(claim);
  }

  if (options.allowed) {
    const { amounts, percentages } = options.allowed;
    const invented = findAmounts(text).find(
      (a) => !amounts.some((v) => close(a.value, v) || (a.annual !== null && close(a.annual, v))),
    );
    if (invented) push("inventedFigure", invented.raw);
    else {
      const pct = findPercentages(text).find((p) => !percentages.some((v) => close(p, v)));
      if (pct !== undefined) push("inventedFigure", `${pct} %`);
    }
  }
  return issues;
}

/** Salaire le plus élevé d'un texte (estimation de la proposition de l'entreprise). */
export function bestSalary(text: string): number | null {
  const values = salaryAmounts(text);
  return values.length > 0 ? Math.max(...values) : null;
}
