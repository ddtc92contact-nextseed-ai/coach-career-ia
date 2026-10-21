import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CompanySignalList } from "@/components/company-signals";
import { PageTitle } from "@/components/empty-state";
import type { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { ATS_LABELS } from "@/lib/radar/careers";
import { listRadarCompanies } from "@/lib/radar/companies";
import { companySourceKey } from "@/lib/radar/followed";
import { failureThreshold, loadSourceHealth, type SourceHealth } from "@/lib/radar/health";
import { formatDuration, loadRecentPasses } from "@/lib/radar/passes";
import { loadCompanyMomentum, type CompanyMomentum } from "@/lib/radar/signals/query";
import { formatSalary, REMOTE_LABELS, CONTRACT_LABELS, SOURCE_LABELS } from "./labels";

export const metadata: Metadata = { title: "Market Radar" };

const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});
const dateOnly = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Europe/Paris" });

export default async function RadarPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const params = await searchParams;
  const q = param(params.q).slice(0, 100);
  const status = ["ouvertes", "fermees", "toutes"].includes(param(params.statut))
    ? param(params.statut)
    : "ouvertes";
  const page = Math.max(1, Number.parseInt(param(params.page), 10) || 1);

  const where: Prisma.JobOfferWhereInput = {
    duplicateOfId: null,
    ...(status === "ouvertes"
      ? { status: "OPEN" }
      : status === "fermees"
        ? { status: "CLOSED" }
        : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { companyName: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const threshold = failureThreshold();
  const [
    health,
    momentum,
    runs,
    offers,
    matching,
    open,
    closed,
    duplicates,
    located,
    companies,
    passes,
  ] = await Promise.all([
    loadSourceHealth(db, { threshold }),
    loadCompanyMomentum(db),
    db.sourceRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    db.jobOffer.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }, { publishedAt: "desc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { _count: { select: { duplicates: true } } },
    }),
    db.jobOffer.count({ where }),
    db.jobOffer.count({ where: { status: "OPEN", duplicateOfId: null } }),
    db.jobOffer.count({ where: { status: "CLOSED", duplicateOfId: null } }),
    db.jobOffer.count({ where: { duplicateOfId: { not: null } } }),
    db.jobOffer.count({
      where: { status: "OPEN", duplicateOfId: null, latitude: { not: null } },
    }),
    listRadarCompanies(db),
    loadRecentPasses(db),
  ]);
  const locatedShare = open > 0 ? Math.round((located / open) * 100) : 0;
  const pages = Math.max(1, Math.ceil(matching / PAGE_SIZE));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status !== "ouvertes") sp.set("statut", status);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/app/radar?${s}` : "/app/radar";
  };

  return (
    <>
      <PageTitle
        title="Market Radar"
        intro="Offres collectées auprès des sources autorisées (API France Travail, job boards ATS publics), normalisées et dédoublonnées."
      />

      <dl className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Offres ouvertes", open, null],
            ["Offres fermées", closed, null],
            ["Doublons rattachés", duplicates, null],
            ["Ouvertes géolocalisées", located, `${locatedShare} % des ouvertes`],
          ] as const
        ).map(([label, value, detail]) => (
          <div key={label} className="border-line bg-surface rounded-xl border px-4 py-3">
            <dt className="text-ink-subtle text-sm">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {value.toLocaleString("fr-FR")}
              {detail ? (
                <span className="text-ink-subtle block text-sm font-normal">{detail}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <RadarPassesSection passes={passes} />

      <SourceHealthSection health={health} threshold={threshold} />

      <WatchedCompaniesSection companies={companies} health={health} />

      <CompanyMomentumSection companies={momentum} />

      <section aria-labelledby="runs-title" className="mb-10">
        <h2 id="runs-title" className="mb-3 text-lg font-semibold">
          Dernières collectes
        </h2>
        {runs.length === 0 ? (
          <p className="text-ink-subtle text-sm">
            Aucune collecte pour l&apos;instant. Lancez <code>npm run radar:run</code> ou démarrez
            le worker.
          </p>
        ) : (
          <div className="border-line bg-surface overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="bg-subtle text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Début</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 text-right font-medium">Reçues</th>
                  <th className="px-3 py-2 text-right font-medium">Créées</th>
                  <th className="px-3 py-2 text-right font-medium">Modifiées</th>
                  <th className="px-3 py-2 text-right font-medium">Fermées</th>
                  <th className="px-3 py-2 text-right font-medium">Doublons</th>
                  <th className="px-3 py-2 font-medium">Erreur</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{run.sourceKey}</td>
                    <td className="text-ink-muted px-3 py-2 whitespace-nowrap">
                      {dateTime.format(run.startedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <RunStatus status={run.status} complete={run.complete} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{run.fetchedCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{run.createdCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{run.updatedCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{run.closedCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{run.duplicateCount}</td>
                    <td
                      className="text-danger-ink max-w-xs truncate px-3 py-2"
                      title={run.error ?? undefined}
                    >
                      {run.error ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="offers-title">
        <h2 id="offers-title" className="mb-3 text-lg font-semibold">
          Offres collectées
        </h2>
        <form method="get" className="mb-4 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="q">
            Rechercher
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Intitulé, entreprise ou ville"
            className="border-line-strong bg-surface min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
          />
          <label className="sr-only" htmlFor="statut">
            Statut
          </label>
          <select
            id="statut"
            name="statut"
            defaultValue={status}
            className="border-line-strong bg-surface rounded-lg border px-3 py-2 text-sm"
          >
            <option value="ouvertes">Ouvertes</option>
            <option value="fermees">Fermées</option>
            <option value="toutes">Toutes</option>
          </select>
          <button
            type="submit"
            className="bg-primary text-on-primary hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-medium"
          >
            Rechercher
          </button>
        </form>

        <p className="text-ink-subtle mb-3 text-sm">
          {matching.toLocaleString("fr-FR")} offre{matching > 1 ? "s" : ""}
          {q ? <> pour « {q} »</> : null}
        </p>

        {offers.length === 0 ? (
          <p className="border-line-strong bg-surface text-ink-subtle rounded-xl border border-dashed px-6 py-10 text-center text-sm">
            Aucune offre ne correspond.
          </p>
        ) : (
          <ul className="divide-line border-line bg-surface divide-y rounded-xl border">
            {offers.map((offer) => {
              const place = [offer.city, offer.region, offer.country].filter(Boolean).join(", ");
              const salary = formatSalary(offer);
              return (
                <li key={offer.id} className="px-4 py-3">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <a
                      href={offer.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="font-medium break-words hover:underline"
                    >
                      {offer.title}
                    </a>
                    <span className="text-ink-subtle shrink-0 text-xs">
                      {SOURCE_LABELS[offer.source] ?? offer.source}
                      {offer._count.duplicates > 0 ? ` +${offer._count.duplicates} doublon(s)` : ""}
                      {offer.status === "CLOSED" ? " · fermée" : ""}
                    </span>
                  </div>
                  <p className="text-ink-muted text-sm">
                    {[
                      offer.companyName ?? "Entreprise non communiquée",
                      place || "Lieu non précisé",
                    ].join(" · ")}
                  </p>
                  <p className="text-ink-subtle mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>{CONTRACT_LABELS[offer.contractType]}</span>
                    <span>{REMOTE_LABELS[offer.remotePolicy]}</span>
                    <span>{salary ?? "Salaire non communiqué"}</span>
                    {offer.publishedAt ? (
                      <span>Publiée le {dateOnly.format(offer.publishedAt)}</span>
                    ) : null}
                    <span>Vue le {dateOnly.format(offer.lastSeenAt)}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {pages > 1 ? (
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="hover:underline">
                ← Précédentes
              </Link>
            ) : (
              <span />
            )}
            <span className="text-ink-subtle">
              Page {page} / {pages}
            </span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="hover:underline">
                Suivantes →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </>
  );
}

/**
 * Passages du radar : durée du dernier passage (une dizaine de minutes pour
 * ~500 boards) et compteurs par source, puis les passages précédents.
 */
function RadarPassesSection({ passes }: { passes: Awaited<ReturnType<typeof loadRecentPasses>> }) {
  const last = passes.find((p) => p.status === "FINISHED");
  const running = passes.find((p) => p.status === "RUNNING");
  const sources = last
    ? Object.entries(last.bySource).sort(
        ([a], [b]) =>
          Number(b === "france_travail") - Number(a === "france_travail") || a.localeCompare(b),
      )
    : [];
  return (
    <section aria-labelledby="passes-title" className="mb-10">
      <h2 id="passes-title" className="mb-1 text-lg font-semibold">
        Passages du radar
      </h2>
      <p className="text-ink-subtle mb-3 text-sm">
        Un passage collecte toutes les sources l&apos;une après l&apos;autre, un seul à la fois.
        {running ? (
          <strong className="text-warning-ink ml-1 font-medium">
            Passage en cours depuis le {dateTime.format(running.startedAt)}.
          </strong>
        ) : null}
      </p>
      {!last ? (
        <p className="text-ink-subtle text-sm">Aucun passage terminé pour l&apos;instant.</p>
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                ["Dernier passage", dateTime.format(last.startedAt)],
                ["Durée", formatDuration(last.durationMs ?? 0)],
                ["Périmètres collectés", `${last.sources} (${last.failed} en échec)`],
                [
                  "Offres reçues",
                  `${last.fetched.toLocaleString("fr-FR")} (${last.created} nouvelles)`,
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="border-line bg-surface rounded-xl border px-4 py-3">
                <dt className="text-ink-subtle text-sm">{label}</dt>
                <dd className="font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="border-line bg-surface mb-4 overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Dernier passage, par source</caption>
              <thead className="bg-subtle text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Périmètres</th>
                  <th className="px-3 py-2 text-right font-medium">En échec</th>
                  <th className="px-3 py-2 text-right font-medium">Reçues</th>
                  <th className="px-3 py-2 text-right font-medium">Créées</th>
                  <th className="px-3 py-2 text-right font-medium">Fermées</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {sources.map(([source, c]) => (
                  <tr key={source}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      {SOURCE_LABELS[source] ?? source}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.sources}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${c.failed > 0 ? "text-danger-ink font-medium" : ""}`}
                    >
                      {c.failed}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.fetched}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.created}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.closed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {passes.length > 1 ? (
        <div className="border-line bg-surface overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Passages récents</caption>
            <thead className="bg-subtle text-ink-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">Début</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 text-right font-medium">Durée</th>
                <th className="px-3 py-2 text-right font-medium">Périmètres</th>
                <th className="px-3 py-2 text-right font-medium">En échec</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {passes.map((p) => (
                <tr key={p.id}>
                  <td className="text-ink-muted px-3 py-2 whitespace-nowrap">
                    {dateTime.format(p.startedAt)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {p.status === "FINISHED" ? (
                      <span className="text-success-ink">Terminé</span>
                    ) : p.status === "RUNNING" ? (
                      <span className="text-warning-ink">En cours</span>
                    ) : (
                      <span className="text-danger-ink">Interrompu</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.durationMs !== null ? formatDuration(p.durationMs) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.sources}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function SourceHealthSection({
  health,
  threshold,
}: {
  health: Awaited<ReturnType<typeof loadSourceHealth>>;
  threshold: number;
}) {
  const failing = health.filter((h) => h.failing).length;
  return (
    <section aria-labelledby="health-title" className="mb-10">
      <h2 id="health-title" className="mb-1 text-lg font-semibold">
        Santé des sources
      </h2>
      <p className="text-ink-subtle mb-3 text-sm">
        Dernier passage de chaque source. Une source est signalée après {threshold} échecs
        consécutifs.
        {failing > 0 ? (
          <strong className="text-danger-ink ml-1 font-medium">
            {failing} source{failing > 1 ? "s" : ""} en alerte.
          </strong>
        ) : null}
      </p>
      {health.length === 0 ? (
        <p className="text-ink-subtle text-sm">Aucune source n&apos;a encore tourné.</p>
      ) : (
        <div className="border-line bg-surface overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-subtle text-ink-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Dernier passage</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 text-right font-medium">Reçues</th>
                <th className="px-3 py-2 text-right font-medium">Créées</th>
                <th className="px-3 py-2 text-right font-medium">Fermées</th>
                <th className="px-3 py-2 text-right font-medium">Doublons</th>
                <th className="px-3 py-2 font-medium">Échecs d&apos;affilée</th>
                <th className="px-3 py-2 font-medium">Dernier succès</th>
                <th className="px-3 py-2 font-medium">Dernière erreur</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {health.map((h) => (
                <tr key={h.sourceKey} className={h.failing ? "bg-danger-soft" : undefined}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {h.sourceKey}
                    <span className="text-ink-subtle block text-xs font-normal">
                      {SOURCE_LABELS[h.source] ?? h.source}
                    </span>
                  </td>
                  <td className="text-ink-muted px-3 py-2 whitespace-nowrap">
                    {dateTime.format(h.lastRun.startedAt)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <RunStatus status={h.lastRun.status} complete={h.lastRun.complete} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.lastRun.fetchedCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.lastRun.createdCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.lastRun.closedCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.lastRun.duplicateCount}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {h.failing ? (
                      <span className="bg-danger-soft text-danger-ink rounded px-1.5 py-0.5 font-medium">
                        ⚠ {h.consecutiveFailures} — en alerte
                      </span>
                    ) : (
                      h.consecutiveFailures
                    )}
                  </td>
                  <td className="text-ink-muted px-3 py-2 whitespace-nowrap">
                    {h.lastSuccessAt ? dateTime.format(h.lastSuccessAt) : "—"}
                  </td>
                  <td className="max-w-xs px-3 py-2" title={h.lastError?.message}>
                    {h.lastError ? (
                      <>
                        <span className="text-danger-ink block truncate">
                          {h.lastError.message}
                        </span>
                        <span className="text-ink-subtle text-xs">
                          {dateTime.format(h.lastError.at)}
                        </span>
                      </>
                    ) : (
                      ""
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Entreprises surveillées : liste de référence et ajouts des candidats
 * (nombre d'abonnés seulement, jamais qui les suit), avec la santé de leur
 * dernier passage.
 */
function WatchedCompaniesSection({
  companies,
  health,
}: {
  companies: Awaited<ReturnType<typeof listRadarCompanies>>;
  health: SourceHealth[];
}) {
  const byKey = new Map(health.map((h) => [h.sourceKey, h]));
  const watched = companies.filter(
    (c) => c.active && (c.origin === "CONFIG" || c._count.followers > 0),
  ).length;
  const added = companies.filter((c) => c.origin === "USER").length;
  const byAts = new Map<string, number>();
  for (const c of companies) {
    if (!c.atsType || !(c.active && (c.origin === "CONFIG" || c._count.followers > 0))) continue;
    byAts.set(ATS_LABELS[c.atsType], (byAts.get(ATS_LABELS[c.atsType]) ?? 0) + 1);
  }
  return (
    <section aria-labelledby="companies-title" className="mb-10">
      <h2 id="companies-title" className="mb-1 text-lg font-semibold">
        Entreprises surveillées
      </h2>
      <p className="text-ink-subtle mb-3 text-sm">
        {watched} entreprise{watched > 1 ? "s" : ""} collectée{watched > 1 ? "s" : ""} à chaque
        passage (liste de référence et entreprises suivies par les candidats, {added} ajoutée
        {added > 1 ? "s" : ""} par des candidats). Chaque board n&apos;est collecté qu&apos;une fois
        par passage, quel que soit son nombre d&apos;abonnés.
      </p>
      {byAts.size > 0 ? (
        <p className="text-ink-subtle mb-3 text-sm">
          Par ATS :{" "}
          {[...byAts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([ats, n]) => `${ats} ${n}`)
            .join(" · ")}
        </p>
      ) : null}
      {companies.length === 0 ? (
        <p className="text-ink-subtle text-sm">Aucune entreprise pour l&apos;instant.</p>
      ) : (
        <div className="border-line bg-surface max-h-[32rem] overflow-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-subtle text-ink-subtle sticky top-0">
              <tr>
                <th className="px-3 py-2 font-medium">Entreprise</th>
                <th className="px-3 py-2 font-medium">Board</th>
                <th className="px-3 py-2 font-medium">Origine</th>
                <th className="px-3 py-2 text-right font-medium">Abonnés</th>
                <th className="px-3 py-2 text-right font-medium">Offres ouvertes</th>
                <th className="px-3 py-2 font-medium">Dernier passage</th>
                <th className="px-3 py-2 font-medium">Santé</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {companies.map((c) => {
                const h = c.atsType
                  ? byKey.get(companySourceKey({ atsType: c.atsType, slug: c.slug }))
                  : undefined;
                const isWatched = c.active && (c.origin === "CONFIG" || c._count.followers > 0);
                return (
                  <tr key={c.id} className={h?.failing ? "bg-danger-soft" : undefined}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{c.name}</td>
                    <td className="text-ink-muted px-3 py-2 whitespace-nowrap">
                      {c.atsType ? ATS_LABELS[c.atsType] : ""}
                      <span className="text-ink-subtle block text-xs">{c.boardToken}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.origin === "CONFIG" ? "Référence" : "Candidats"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c._count.followers}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c._count.offers}</td>
                    <td className="text-ink-muted px-3 py-2 whitespace-nowrap">
                      {h ? dateTime.format(h.lastRun.startedAt) : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {!isWatched ? (
                        <span className="text-ink-subtle">Non surveillée</span>
                      ) : !h ? (
                        <span className="text-ink-subtle">En attente</span>
                      ) : h.failing ? (
                        <span className="text-danger-ink font-medium">
                          ⚠ {h.consecutiveFailures} échecs
                        </span>
                      ) : (
                        <RunStatus status={h.lastRun.status} complete={h.lastRun.complete} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function CompanyMomentumSection({ companies }: { companies: CompanyMomentum[] }) {
  const [t, format] = await Promise.all([getTranslations("companySignals.admin"), getFormatter()]);
  const share = (value: number | null | undefined) =>
    value === null || value === undefined ? t("notAvailable") : t("percent", { value });
  return (
    <section aria-labelledby="momentum-title" className="mb-10">
      <h2 id="momentum-title" className="mb-1 text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-ink-subtle mb-3 text-sm">{t("intro")}</p>
      {companies.length === 0 ? (
        <p className="text-ink-subtle text-sm">{t("empty")}</p>
      ) : (
        <div className="border-line bg-surface overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-subtle text-ink-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">{t("company")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("open")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("lastWeek")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("timeToClose")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("salaryShare")}</th>
                <th className="px-3 py-2 font-medium">{t("signals")}</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {companies.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{c.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {format.number(c.openOffers)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {c.lastWeek
                      ? t("lastWeekValue", {
                          newOffers: c.lastWeek.newOffers,
                          closedOffers: c.lastWeek.closedOffers,
                        })
                      : t("notAvailable")}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {c.lastWeek?.medianDaysToClose != null
                      ? t("days", { days: c.lastWeek.medianDaysToClose })
                      : t("notAvailable")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {share(c.lastWeek?.salaryShare)}
                  </td>
                  <td className="min-w-72 px-3 py-2">
                    {c.signals.length > 0 ? (
                      <CompanySignalList signals={c.signals} compact />
                    ) : (
                      <span className="text-ink-subtle">{t("none")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunStatus({ status, complete }: { status: string; complete: boolean }) {
  if (status === "FAILED") return <span className="text-danger-ink font-medium">Échec</span>;
  if (status === "RUNNING") return <span className="text-warning-ink">En cours</span>;
  return <span className="text-success-ink">{complete ? "Réussie" : "Réussie (partielle)"}</span>;
}
