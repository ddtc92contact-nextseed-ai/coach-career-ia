import type { ContractTypeCode } from "@/lib/career/codes";
import { bestSalary } from "./check";
import { contractNegations, contractsIn, remoteDaysIn, sentences } from "./figures";
import type { Mandate } from "./mandate";

/**
 * Analyse de la dernière proposition de l'entreprise au regard du mandat,
 * sans IA : une ESTIMATION à partir des chiffres et mots-clés reconnus, à
 * présenter comme telle. Les points libres (lieu, intitulé, date, autres)
 * ne sont pas évalués automatiquement.
 */

export type PointStatus = "met" | "notMet" | "unknown";

export type OfferAnalysis = {
  salary: {
    offered: number | null;
    status: "aboveTarget" | "aboveFloor" | "belowFloor" | "unknown";
  };
  remote: { offered: number | null; status: PointStatus } | null;
  contract: { offered: ContractTypeCode | null; status: PointStatus } | null;
  /** Points non évalués automatiquement : à vérifier par le candidat. */
  unchecked: number;
};

export function analyseOffer(text: string, mandate: Mandate): OfferAnalysis {
  const offered = bestSalary(text);
  const salaryStatus =
    offered === null
      ? "unknown"
      : offered < mandate.salaryFloor
        ? "belowFloor"
        : mandate.salaryTarget !== null && offered >= mandate.salaryTarget
          ? "aboveTarget"
          : "aboveFloor";

  let remote: OfferAnalysis["remote"] = null;
  if (mandate.remoteDaysMin !== null) {
    const days = sentences(text)
      .map(remoteDaysIn)
      .filter((d): d is number => d !== null);
    const best = days.length > 0 ? Math.max(...days) : null;
    remote = {
      offered: best,
      status: best === null ? "unknown" : best >= mandate.remoteDaysMin ? "met" : "notMet",
    };
  }

  let contract: OfferAnalysis["contract"] = null;
  if (mandate.contractType) {
    const found = sentences(text).flatMap((s) =>
      contractsIn(s).filter((c) => contractNegations(s, c).some((negated) => !negated)),
    );
    const offeredContract = found.includes(mandate.contractType)
      ? mandate.contractType
      : (found[0] ?? null);
    contract = {
      offered: offeredContract,
      status:
        offeredContract === null
          ? "unknown"
          : offeredContract === mandate.contractType
            ? "met"
            : "notMet",
    };
  }

  const unchecked =
    [mandate.location, mandate.startDate, mandate.title].filter(Boolean).length +
    mandate.otherPoints.length;

  return { salary: { offered, status: salaryStatus }, remote, contract, unchecked };
}
