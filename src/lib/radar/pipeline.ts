import type { PrismaClient } from "@/generated/prisma/client";
import type { Geocoder } from "@/lib/geo/geocoder";
import { locateOffer, type OfferGeoColumns } from "@/lib/geo/offers";
import { logger as defaultLogger, scrubString, type Logger } from "@/lib/logger";
import { dedupKey, normalizeUrl, tidyLocation } from "./normalize";
import { sha256 } from "./text";
import type { Connector, ConnectorContext, NormalizedOffer, SourceName } from "./types";

export type RunSummary = {
  source: SourceName;
  sourceKey: string;
  status: "SUCCESS" | "FAILED";
  complete: boolean;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  closed: number;
  skipped: number;
  duplicates: number;
  error: string | null;
};

export type PipelineOptions = ConnectorContext & {
  /** Pays conservés (ISO-2). Vide = tous. Les offres sans pays connu sont gardées. */
  allowedCountries?: string[];
  logger?: Logger;
  /**
   * Géocode les offres nouvelles ou dont le lieu a changé (sauf si la source
   * fournit déjà les coordonnées). Absent : coordonnées de la source seules.
   */
  geocoder?: Geocoder | null;
};

/** Les sources « employeur » (ATS) font foi face aux agrégateurs. */
const SOURCE_PRIORITY: Record<string, number> = {
  greenhouse: 0,
  lever: 0,
  ashby: 0,
  smartrecruiters: 0,
  recruitee: 0,
  workable: 0,
  france_travail: 1,
};

type Counts = Omit<RunSummary, "source" | "sourceKey" | "status" | "complete" | "error">;

function offerData(offer: NormalizedOffer) {
  const salary = offer.salary;
  const location = tidyLocation(offer.location);
  return {
    url: offer.url,
    urlKey: normalizeUrl(offer.canonicalUrl ?? offer.url),
    dedupKey: dedupKey({ ...offer, location }),
    title: offer.title,
    companyName: offer.companyName,
    companyId: offer.companyId ?? null,
    description: offer.description,
    city: location.city,
    region: location.region,
    country: location.country,
    remotePolicy: offer.remotePolicy,
    contractType: offer.contractType,
    contractLabel: offer.contractLabel,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary?.currency ?? null,
    salaryPeriod: salary?.period ?? null,
    salaryVariable: salary?.variable ?? null,
    salaryEquity: salary?.equity ?? null,
    salaryRaw: salary?.raw ?? null,
    sector: offer.sector,
    seniority: offer.seniority,
    publishedAt: offer.publishedAt,
    applyEmail: offer.apply?.email ?? null,
    applyEmailPersonal: offer.apply?.email ? offer.apply.emailPersonal : false,
    applyUrl: offer.apply?.url ?? null,
  };
}

export function contentHash(data: ReturnType<typeof offerData>): string {
  return sha256(JSON.stringify({ ...data, publishedAt: data.publishedAt?.toISOString() ?? null }));
}

/**
 * Collecte un périmètre : fetch → map → upsert, puis fermeture des offres
 * disparues si la collecte est complète. Ne lève jamais : un échec est
 * consigné dans `SourceRun` et renvoyé dans le résumé.
 */
export async function runConnector<Raw>(
  prisma: PrismaClient,
  connector: Connector<Raw>,
  options: PipelineOptions,
): Promise<RunSummary> {
  const log = options.logger ?? defaultLogger;
  const startedAt = options.now();
  const counts: Counts = {
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    closed: 0,
    skipped: 0,
    duplicates: 0,
  };
  const base = { source: connector.source, sourceKey: connector.key };
  let complete = false;

  const run = await prisma.sourceRun.create({ data: { ...base, startedAt } });
  log.info("radar.run.started", { sourceKey: connector.key });

  try {
    const result = await connector.fetch(options);
    complete = result.complete;
    counts.fetched = result.items.length;

    const offers = new Map<string, NormalizedOffer>();
    for (const raw of result.items) {
      let offer: NormalizedOffer | null = null;
      try {
        offer = connector.map(raw);
      } catch {
        offer = null;
      }
      const country = offer?.location.country;
      const outOfScope =
        country && options.allowedCountries?.length && !options.allowedCountries.includes(country);
      if (!offer || outOfScope) {
        counts.skipped++;
        continue;
      }
      offers.set(offer.sourceId, offer);
    }

    for (const offer of offers.values()) {
      const outcome = await upsertOffer(prisma, connector, offer, startedAt, options.geocoder);
      counts[outcome.kind]++;
      if (outcome.duplicate) counts.duplicates++;
    }

    if (complete) {
      // Garde-fou : une réponse vide alors que des offres sont ouvertes
      // ressemble davantage à une panne qu'à une fermeture massive.
      const open = await prisma.jobOffer.count({
        where: { sourceKey: connector.key, status: "OPEN" },
      });
      if (offers.size === 0 && counts.skipped === 0 && open > 0) {
        log.warn("radar.run.empty_result_kept_open", { sourceKey: connector.key, open });
      } else {
        const closed = await prisma.jobOffer.updateMany({
          where: { sourceKey: connector.key, status: "OPEN", lastSeenAt: { lt: startedAt } },
          data: { status: "CLOSED", closedAt: startedAt },
        });
        counts.closed = closed.count;
      }
    }
    // Les doublons d'une offre fermée redeviennent canoniques.
    await prisma.jobOffer.updateMany({
      where: { status: "OPEN", duplicateOf: { status: "CLOSED" } },
      data: { duplicateOfId: null },
    });

    await prisma.sourceRun.update({
      where: { id: run.id },
      data: { ...countColumns(counts), status: "SUCCESS", complete, finishedAt: options.now() },
    });
    log.info("radar.run.finished", { sourceKey: connector.key, complete, ...counts });
    return { ...base, ...counts, status: "SUCCESS", complete, error: null };
  } catch (error) {
    const message = scrubString(error instanceof Error ? error.message : String(error));
    await prisma.sourceRun
      .update({
        where: { id: run.id },
        data: {
          ...countColumns(counts),
          status: "FAILED",
          complete: false,
          error: message,
          finishedAt: options.now(),
        },
      })
      .catch(() => undefined);
    log.error("radar.run.failed", { sourceKey: connector.key, error: message, ...counts });
    return { ...base, ...counts, status: "FAILED", complete: false, error: message };
  }
}

function countColumns(c: Counts) {
  return {
    fetchedCount: c.fetched,
    createdCount: c.created,
    updatedCount: c.updated,
    unchangedCount: c.unchanged,
    closedCount: c.closed,
    skippedCount: c.skipped,
    duplicateCount: c.duplicates,
  };
}

type UpsertOutcome = { kind: "created" | "updated" | "unchanged"; duplicate: boolean };

async function upsertOffer<Raw>(
  prisma: PrismaClient,
  connector: Connector<Raw>,
  offer: NormalizedOffer,
  seenAt: Date,
  geocoder: Geocoder | null = null,
): Promise<UpsertOutcome> {
  const data = offerData(offer);
  const hash = contentHash(data);
  const where = { source_sourceId: { source: connector.source, sourceId: offer.sourceId } };
  const existing = await prisma.jobOffer.findUnique({
    where,
    select: {
      id: true,
      contentHash: true,
      city: true,
      country: true,
      latitude: true,
      longitude: true,
      geocodedAt: true,
    },
  });
  const geo = await offerGeo(offer, data, existing, geocoder, seenAt);
  const seen = {
    lastSeenAt: seenAt,
    status: "OPEN" as const,
    closedAt: null,
    sourceKey: connector.key,
  };

  let kind: UpsertOutcome["kind"];
  let row: {
    id: string;
    source: string;
    urlKey: string;
    dedupKey: string | null;
    firstSeenAt: Date;
  };
  const select = { id: true, source: true, urlKey: true, dedupKey: true, firstSeenAt: true };
  if (!existing) {
    row = await prisma.jobOffer.create({
      data: {
        ...data,
        ...seen,
        source: connector.source,
        sourceId: offer.sourceId,
        firstSeenAt: seenAt,
        contentHash: hash,
        ...geo,
      },
      select,
    });
    kind = "created";
  } else if (existing.contentHash !== hash) {
    row = await prisma.jobOffer.update({
      where,
      data: { ...data, ...seen, ...geo, contentHash: hash },
      select,
    });
    kind = "updated";
  } else {
    row = await prisma.jobOffer.update({ where, data: { ...seen, ...geo }, select });
    kind = "unchanged";
  }

  return { kind, duplicate: await resolveDuplicate(prisma, row) };
}

/**
 * Colonnes de géolocalisation à écrire, ou `{}` pour conserver l'existant :
 * on ne regéocode que si la source donne des coordonnées, si l'offre est
 * nouvelle, si son lieu a changé ou si elle n'a jamais été géocodée.
 */
async function offerGeo(
  offer: NormalizedOffer,
  data: ReturnType<typeof offerData>,
  existing: {
    city: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    geocodedAt: Date | null;
  } | null,
  geocoder: Geocoder | null,
  now: Date,
): Promise<Partial<OfferGeoColumns>> {
  const sameCoordinates =
    existing?.latitude === (offer.coordinates?.latitude ?? null) &&
    existing?.longitude === (offer.coordinates?.longitude ?? null);
  const samePlace =
    existing !== null &&
    existing.geocodedAt !== null &&
    existing.city === data.city &&
    existing.country === data.country;
  if (samePlace && (!offer.coordinates || sameCoordinates)) return {};
  return locateOffer(
    {
      city: data.city,
      country: data.country,
      postalCode: offer.postalCode,
      cityCode: offer.cityCode,
      coordinates: offer.coordinates,
    },
    geocoder,
    now,
  );
}

/**
 * Dédoublonnage inter-sources : même URL d'origine, ou même entreprise +
 * intitulé normalisé + lieu. L'offre canonique est celle de la source la plus
 * directe (ATS de l'employeur), puis la plus ancienne. Renvoie vrai si
 * l'offre est un doublon.
 */
async function resolveDuplicate(
  prisma: PrismaClient,
  offer: { id: string; source: string; urlKey: string; dedupKey: string | null; firstSeenAt: Date },
): Promise<boolean> {
  const keys = [
    { urlKey: offer.urlKey },
    ...(offer.dedupKey ? [{ dedupKey: offer.dedupKey }] : []),
  ];
  const others = await prisma.jobOffer.findMany({
    where: { id: { not: offer.id }, source: { not: offer.source }, status: "OPEN", OR: keys },
    select: { id: true, source: true, firstSeenAt: true },
  });
  if (others.length === 0) {
    await prisma.jobOffer.update({ where: { id: offer.id }, data: { duplicateOfId: null } });
    return false;
  }

  const rank = (o: { source: string; firstSeenAt: Date; id: string }) =>
    [SOURCE_PRIORITY[o.source] ?? 9, o.firstSeenAt.getTime(), o.id] as const;
  const better = (a: typeof offer, b: typeof offer) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! < rb[i]!;
    return false;
  };
  const canonical = [offer, ...others.map((o) => ({ ...o, urlKey: "", dedupKey: null }))].reduce(
    (best, o) => (better(o, best) ? o : best),
  );

  if (canonical.id === offer.id) {
    await prisma.jobOffer.update({ where: { id: offer.id }, data: { duplicateOfId: null } });
    await prisma.jobOffer.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { duplicateOfId: offer.id },
    });
    return false;
  }
  await prisma.jobOffer.update({ where: { id: offer.id }, data: { duplicateOfId: canonical.id } });
  return true;
}

/** Exécute chaque connecteur l'un après l'autre ; un échec n'arrête pas les autres. */
export async function runConnectors(
  prisma: PrismaClient,
  connectors: Connector<unknown>[],
  options: PipelineOptions,
): Promise<RunSummary[]> {
  const summaries: RunSummary[] = [];
  for (const connector of connectors) {
    try {
      summaries.push(await runConnector(prisma, connector, options));
    } catch (error) {
      // Ex. base indisponible au moment de créer le SourceRun.
      const message = scrubString(error instanceof Error ? error.message : String(error));
      (options.logger ?? defaultLogger).error("radar.run.crashed", {
        sourceKey: connector.key,
        error: message,
      });
      summaries.push({
        source: connector.source,
        sourceKey: connector.key,
        status: "FAILED",
        complete: false,
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        closed: 0,
        skipped: 0,
        duplicates: 0,
        error: message,
      });
    }
  }
  return summaries;
}
