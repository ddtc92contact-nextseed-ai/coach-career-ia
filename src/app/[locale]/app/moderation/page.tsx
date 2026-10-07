import type { Metadata } from "next";
import { Badge } from "@/components/badge";
import { PageTitle } from "@/components/empty-state";
import { requireAdmin } from "@/lib/auth/admin";
import { getModerationQueue } from "@/lib/employer/admin";
import type { FlagCategory } from "@/lib/employer/moderation";
import {
  approveOrganizationAction,
  approvePostingAction,
  rejectPostingAction,
  suspendOrganizationAction,
} from "./actions";

export const metadata: Metadata = { title: "Modération", robots: { index: false } };

/** Page d'administration (en français uniquement, comme le Radar). */

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});
const money = (value: { toString(): string } | null, currency: string | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: currency ?? "EUR",
        maximumFractionDigits: 0,
      }).format(Number(value.toString()));

const DONE: Record<string, string> = {
  orgApproved: "Organisation validée (offres payées publiées, e-mail envoyé).",
  orgSuspended: "Organisation suspendue (offres fermées, e-mail envoyé).",
  postingApproved: "Offre approuvée (e-mail envoyé).",
  postingRejected: "Offre refusée (e-mail envoyé).",
};
const ERRORS: Record<string, string> = {
  invalide: "Demande invalide.",
  motif: "Indiquez un motif (3 caractères au moins) : il est envoyé à l’entreprise.",
  etat: "Action impossible dans l’état actuel (déjà traitée ?).",
};
const FLAGS: Record<FlagCategory, string> = {
  age: "âge",
  sex: "sexe",
  origin: "origine",
  family: "situation familiale",
};
const PERIOD: Record<string, string> = {
  YEAR: "/ an",
  MONTH: "/ mois",
  DAY: "/ jour",
  HOUR: "/ heure",
};

const sectionClass = "rounded-2xl border border-stone-200 bg-white p-4 sm:p-6";
const button =
  "w-full rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium whitespace-nowrap hover:bg-stone-100 sm:w-auto";
const danger =
  "w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-medium whitespace-nowrap text-red-700 hover:bg-red-50 sm:w-auto";
const reasonInput = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";

function RejectForm({
  action,
  name,
  value,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  name: string;
  value: string;
  label: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name={name} value={value} />
      <label className="flex-1 text-sm">
        <span className="sr-only">Motif</span>
        <input
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          placeholder="Motif (envoyé à l’entreprise)"
          className={reasonInput}
        />
      </label>
      <button type="submit" className={danger}>
        {label}
      </button>
    </form>
  );
}

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ fait?: string; erreur?: string }>;
}) {
  await requireAdmin();
  const [query, queue] = await Promise.all([searchParams, getModerationQueue()]);

  return (
    <div className="max-w-4xl space-y-8">
      <PageTitle
        title="Modération de l’espace entreprise"
        intro="Organisations en attente (domaine non vérifié), offres signalées ou en revue, suspension. Rappel produit : une entreprise ne voit jamais de liste ni de classement de candidats."
      />
      {query.fait && DONE[query.fait] ? (
        <p
          role="status"
          className="border-brand-100 bg-brand-50 text-brand-900 rounded-lg border px-4 py-3 text-sm"
        >
          {DONE[query.fait]}
        </p>
      ) : null}
      {query.erreur ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {ERRORS[query.erreur] ?? "Action impossible."}
        </p>
      ) : null}

      <section aria-labelledby="orgs-pending" className="space-y-3">
        <h2 id="orgs-pending" className="text-lg font-semibold">
          Organisations en attente ({queue.pendingOrgs.length})
        </h2>
        {queue.pendingOrgs.length === 0 ? (
          <p className="text-sm text-stone-500">Aucune organisation en attente.</p>
        ) : null}
        {queue.pendingOrgs.map((org) => (
          <article key={org.id} className={sectionClass}>
            <h3 className="font-semibold break-words">{org.name}</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-stone-500">Site</dt>
              <dd className="break-all">{org.website}</dd>
              <dt className="text-stone-500">Inscrit avec</dt>
              <dd className="break-all">{org.ownerEmails.join(", ") || "—"}</dd>
              <dt className="text-stone-500">Pays / secteur</dt>
              <dd>
                {org.country} · {org.sector}
              </dd>
              <dt className="text-stone-500">Créée le</dt>
              <dd>{dateTime.format(org.createdAt)}</dd>
            </dl>
            <div className="mt-4 space-y-3">
              <form action={approveOrganizationAction}>
                <input type="hidden" name="orgId" value={org.id} />
                <button type="submit" className={button}>
                  Valider l’organisation
                </button>
              </form>
              <RejectForm
                action={suspendOrganizationAction}
                name="orgId"
                value={org.id}
                label="Refuser"
              />
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="postings-review" className="space-y-3">
        <h2 id="postings-review" className="text-lg font-semibold">
          Offres en revue ({queue.reviewPostings.length})
        </h2>
        {queue.reviewPostings.length === 0 ? (
          <p className="text-sm text-stone-500">Aucune offre en revue.</p>
        ) : null}
        {queue.reviewPostings.map((posting) => (
          <article key={posting.id} className={sectionClass}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold break-words">{posting.offer.title}</h3>
              {posting.organization.status !== "ACTIVE" ? (
                <Badge tone="warning">Organisation {posting.organization.status}</Badge>
              ) : null}
              {posting.flags.map((flag) => (
                <Badge key={flag} tone="warning">
                  Signalé : {FLAGS[flag as FlagCategory] ?? flag}
                </Badge>
              ))}
            </div>
            <p className="mt-1 text-sm text-stone-600">
              {posting.organization.name} · {posting.offer.city ?? "—"} ·{" "}
              {money(posting.offer.salaryMin, posting.offer.salaryCurrency)} –{" "}
              {money(posting.offer.salaryMax, posting.offer.salaryCurrency)}{" "}
              {posting.offer.salaryPeriod ? PERIOD[posting.offer.salaryPeriod] : ""}
            </p>
            {posting.excerpts.length > 0 ? (
              <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
                {posting.excerpts.map((excerpt) => (
                  <li key={excerpt.category}>
                    {FLAGS[excerpt.category]} : « {excerpt.excerpt} »
                  </li>
                ))}
              </ul>
            ) : null}
            {posting.reviewNote ? (
              <p className="mt-2 text-sm text-stone-600">Refus précédent : {posting.reviewNote}</p>
            ) : null}
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-stone-600">Lire la description</summary>
              <p className="mt-2 whitespace-pre-line text-stone-700">{posting.offer.description}</p>
            </details>
            <div className="mt-4 space-y-3">
              <form action={approvePostingAction}>
                <input type="hidden" name="postingId" value={posting.id} />
                <button type="submit" className={button}>
                  Approuver l’offre
                </button>
              </form>
              <RejectForm
                action={rejectPostingAction}
                name="postingId"
                value={posting.id}
                label="Refuser l’offre"
              />
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="orgs-active" className="space-y-3">
        <h2 id="orgs-active" className="text-lg font-semibold">
          Organisations actives et suspendues
        </h2>
        {queue.activeOrgs.length === 0 ? (
          <p className="text-sm text-stone-500">Aucune organisation.</p>
        ) : null}
        <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white">
          {queue.activeOrgs.map((org) => (
            <li key={org.id} className="space-y-3 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium break-words">{org.name}</span>
                <span className="text-stone-500">{org.domain}</span>
                <Badge tone={org.status === "ACTIVE" ? "proven" : "warning"}>
                  {org.status === "ACTIVE" ? "Active" : "Suspendue"}
                </Badge>
                <span className="text-stone-500">{org._count.postings} en ligne</span>
              </div>
              {org.status === "ACTIVE" ? (
                <RejectForm
                  action={suspendOrganizationAction}
                  name="orgId"
                  value={org.id}
                  label="Suspendre (ferme ses offres)"
                />
              ) : (
                <>
                  {org.reviewNote ? (
                    <p className="text-stone-600">Motif : {org.reviewNote}</p>
                  ) : null}
                  <form action={approveOrganizationAction}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <button type="submit" className={button}>
                      Réactiver
                    </button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
