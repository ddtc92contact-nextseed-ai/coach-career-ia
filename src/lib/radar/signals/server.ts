import "server-only";
import { db } from "@/lib/db";
import { loadCompanySignals, type CompanySignalView, type SignalQuery } from "./query";

export type { CompanySignalView } from "./query";

/**
 * Signaux récents d'une entreprise (Market Radar), du plus pertinent au moins
 * pertinent. Point d'entrée prévu pour le matching et le coach ; n'influence
 * aucun score pour l'instant.
 */
export async function getCompanySignals(
  companyId: string,
  query: SignalQuery = {},
): Promise<CompanySignalView[]> {
  return loadCompanySignals(db, companyId, query);
}
