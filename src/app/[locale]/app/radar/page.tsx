import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { PageTitle } from "@/components/empty-state";
import type { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db";
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

  const [runs, offers, matching, open, closed, duplicates] = await Promise.all([
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
  ]);
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

      <dl className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["Offres ouvertes", open],
          ["Offres fermées", closed],
          ["Doublons rattachés", duplicates],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
            <dt className="text-sm text-stone-500">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {Number(value).toLocaleString("fr-FR")}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="runs-title" className="mb-10">
        <h2 id="runs-title" className="mb-3 text-lg font-semibold">
          Dernières collectes
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-stone-500">
            Aucune collecte pour l&apos;instant. Lancez <code>npm run radar:run</code> ou démarrez
            le worker.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-stone-500">
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
              <tbody className="divide-y divide-stone-100">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{run.sourceKey}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-stone-600">
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
                      className="max-w-xs truncate px-3 py-2 text-red-700"
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
            className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
          <label className="sr-only" htmlFor="statut">
            Statut
          </label>
          <select
            id="statut"
            name="statut"
            defaultValue={status}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="ouvertes">Ouvertes</option>
            <option value="fermees">Fermées</option>
            <option value="toutes">Toutes</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          >
            Rechercher
          </button>
        </form>

        <p className="mb-3 text-sm text-stone-500">
          {matching.toLocaleString("fr-FR")} offre{matching > 1 ? "s" : ""}
          {q ? <> pour « {q} »</> : null}
        </p>

        {offers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-10 text-center text-sm text-stone-500">
            Aucune offre ne correspond.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
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
                    <span className="shrink-0 text-xs text-stone-500">
                      {SOURCE_LABELS[offer.source] ?? offer.source}
                      {offer._count.duplicates > 0 ? ` +${offer._count.duplicates} doublon(s)` : ""}
                      {offer.status === "CLOSED" ? " · fermée" : ""}
                    </span>
                  </div>
                  <p className="text-sm text-stone-600">
                    {[
                      offer.companyName ?? "Entreprise non communiquée",
                      place || "Lieu non précisé",
                    ].join(" · ")}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
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
            <span className="text-stone-500">
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

function RunStatus({ status, complete }: { status: string; complete: boolean }) {
  if (status === "FAILED") return <span className="font-medium text-red-700">Échec</span>;
  if (status === "RUNNING") return <span className="text-amber-700">En cours</span>;
  return <span className="text-emerald-700">{complete ? "Réussie" : "Réussie (partielle)"}</span>;
}
