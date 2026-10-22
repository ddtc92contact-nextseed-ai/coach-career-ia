import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { EARTH_RADIUS_KM, isValidPoint, type RadiusLocation } from "@/lib/geo/distance";
import { ANNUAL_FACTORS } from "./salary";
import type { CandidateRails } from "./types";

/**
 * Pré-filtre SQL des garde-fous (issue #64) : écarte en base, sans lire leur
 * description, les offres qui violent CERTAINEMENT un garde-fou exprimable en
 * SQL (télétravail, contrat, zone, salaire plancher). Il est volontairement
 * large : une offre douteuse (valeur absente, arrondi, bord de zone) est
 * gardée, et les garde-fous complets (`checkGuardRails`) restent appliqués
 * ensuite en mémoire. Le résultat du matching est donc identique ; seules
 * moins d'offres sont lues. Chaque condition est encadrée par
 * `COALESCE(…, TRUE)` : un `NULL` SQL garde l'offre.
 */

/** Marge relative des zones (arrondis flottants : la zone SQL est un peu plus large). */
const BOX_MARGIN = 1.001;
const DEG = 180 / Math.PI;

export type LatLngBox = {
  minLat: number;
  maxLat: number;
  /** `null` : pas de contrainte de longitude (pôle ou antiméridien dans la zone). */
  minLng: number | null;
  maxLng: number | null;
};

/**
 * Rectangle de latitude / longitude qui contient tout le disque « lieu +
 * rayon » (distance orthodromique), ou `null` si le lieu ne peut rien
 * accepter (coordonnées ou rayon invalides, comme pour `isWithinRadius`).
 */
export function locationBox(location: RadiusLocation): LatLngBox | null {
  if (!isValidPoint(location)) return null;
  if (!Number.isFinite(location.radiusKm) || location.radiusKm < 0) return null;
  const angle = (location.radiusKm / EARTH_RADIUS_KM) * BOX_MARGIN + 1e-9;
  const dLat = angle * DEG;
  const { latitude: lat, longitude: lng } = location;
  const box = { minLat: lat - dLat, maxLat: lat + dLat, minLng: null, maxLng: null };
  // Écart de longitude maximal d'un point du disque : asin(sin δ / cos φ).
  const ratio = Math.sin(Math.min(angle, Math.PI / 2)) / Math.cos(lat / DEG);
  if (angle >= Math.PI / 2 || Math.abs(lat) + dLat >= 90 || ratio >= 1) return box;
  const dLng = Math.asin(ratio) * DEG * BOX_MARGIN + 1e-9;
  if (lng - dLng < -180 || lng + dLng > 180) return box;
  return { ...box, minLng: lng - dLng, maxLng: lng + dLng };
}

const keep = (condition: Prisma.Sql) => Prisma.sql`COALESCE((${condition}), TRUE)`;

/** Conditions SQL (à combiner par AND) correspondant aux garde-fous exprimables en base. */
export function railsPrefilter(rails: CandidateRails): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];

  // Télétravail (`remotePolicyRule`, `remoteDaysRule`).
  if (rails.remotePolicy === "FULL_REMOTE") {
    conditions.push(keep(Prisma.sql`remote_policy IN ('FULL_REMOTE', 'UNKNOWN')`));
  } else if (rails.remotePolicy === "HYBRID" || (rails.minRemoteDays ?? 0) > 0) {
    conditions.push(keep(Prisma.sql`remote_policy <> 'ONSITE'`));
  }

  // Types de contrat (`contractTypeRule`) : un contrat non précisé n'est pas exclu.
  if (rails.contractTypes.length > 0) {
    const accepted = [...rails.contractTypes, "UNKNOWN"];
    conditions.push(keep(Prisma.sql`contract_type::text = ANY(${accepted}::text[])`));
  }

  // Zone (`locationRule`) : télétravail complet, ou dans le rectangle d'un lieu.
  const located = rails.locations.filter((l) => isValidPoint(l));
  if (located.length > 0) {
    const boxes = located.flatMap((l) => {
      const box = locationBox(l);
      if (!box) return [];
      const lng =
        box.minLng === null
          ? Prisma.empty
          : Prisma.sql`AND longitude BETWEEN ${box.minLng}::float8 AND ${box.maxLng}::float8`;
      return [
        Prisma.sql`(latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN ${box.minLat}::float8 AND ${box.maxLat}::float8 ${lng})`,
      ];
    });
    const inZone = boxes.length > 0 ? Prisma.join(boxes, " OR ") : Prisma.sql`FALSE`;
    conditions.push(keep(Prisma.sql`remote_policy = 'FULL_REMOTE' OR ${inZone}`));
  }

  // Salaire plancher (`salaryFloorRule` / `annualSalary`) : seule une offre
  // dont le haut de fourchette annualisé est sous le plancher (avec 1 € de
  // marge d'arrondi) est écartée.
  if (rails.minFixedSalary !== null) {
    const high = Prisma.sql`COALESCE(salary_max, salary_min)`;
    const low = Prisma.sql`COALESCE(salary_min, salary_max)`;
    const annual = Prisma.join(
      Object.entries(ANNUAL_FACTORS).map(
        ([period, factor]) => Prisma.sql`WHEN ${period} THEN ${high} * ${factor}::numeric`,
      ),
      " ",
    );
    const below = Prisma.sql`${low} > 0 AND ${high} > 0
      AND (salary_currency IS NULL OR salary_currency = '' OR upper(salary_currency) = 'EUR')
      AND (CASE COALESCE(salary_period::text, CASE WHEN ${high} >= 10000 THEN 'YEAR' END)
             ${annual} END) < ${rails.minFixedSalary - 1}::numeric`;
    conditions.push(keep(Prisma.sql`NOT COALESCE((${below}), FALSE)`));
  }

  return conditions;
}

/**
 * Identifiants (triés) des offres ouvertes et canoniques qui passent le
 * pré-filtre : quelques dizaines d'octets par offre, aucune description.
 */
export async function prefilteredOfferIds(
  prisma: PrismaClient,
  rails: CandidateRails,
): Promise<string[]> {
  const conditions = [
    Prisma.sql`status = 'OPEN'`,
    Prisma.sql`duplicate_of_id IS NULL`,
    ...railsPrefilter(rails),
  ];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM job_offers WHERE ${Prisma.join(conditions, " AND ")} ORDER BY id`;
  return rows.map((r) => r.id);
}
