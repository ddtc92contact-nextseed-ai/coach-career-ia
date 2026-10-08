import type { Metadata } from "next";
import { PageTitle } from "@/components/empty-state";
import { Badge } from "@/components/badge";
import { requireAdmin } from "@/lib/auth/admin";
import { billingMode } from "@/lib/billing/config";
import { getEntitlements } from "@/lib/billing/server";
import { getCurrentSimulatedSubscription } from "@/lib/billing/simulator-server";
import { db } from "@/lib/db";
import { adminSimulatorAction, findBillingUser } from "./actions";

export const metadata: Metadata = { title: "Simulateur de paiement", robots: { index: false } };

/** Page d'administration (en français uniquement, comme le Radar). */

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

const ACTIONS = {
  forcePremium: {
    label: "Forcer Premium",
    hint: "Paiement simulé accepté (ou reprise / régularisation de l'abonnement en cours).",
  },
  forceFree: {
    label: "Forcer l'offre gratuite",
    hint: "Résiliation immédiate de l'abonnement simulé.",
  },
  periodEnd: {
    label: "Avancer à la fin de période",
    hint: "Renouvellement payé, fin d'un abonnement résilié, ou relances épuisées après un échec (→ gratuit).",
  },
  failRenewal: {
    label: "Faire échouer le renouvellement",
    hint: "Carte refusée à l'échéance : statut PAST_DUE, Premium conservé pendant les relances. Puis « fin de période » pour épuiser les relances.",
  },
} as const;
type ActionKey = keyof typeof ACTIONS;
const isAction = (v: string | undefined): v is ActionKey => !!v && v in ACTIONS;

const ERRORS: Record<string, string> = {
  inactif: "Le simulateur n'est pas actif (BILLING_PROVIDER ≠ simulator).",
  invalide: "Demande invalide.",
};

const button =
  "w-full rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-medium whitespace-nowrap hover:bg-muted sm:w-auto sm:shrink-0";

export default async function BillingSimulatorAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; fait?: string; erreur?: string; introuvable?: string }>;
}) {
  await requireAdmin();
  const query = await searchParams;
  const active = billingMode() === "simulator";
  const target = query.u
    ? await db.user.findUnique({
        where: { id: query.u },
        select: { id: true, email: true },
      })
    : null;
  // Droits d'abord : ils appliquent une échéance passée du simulateur.
  const entitlements = target ? await getEntitlements(target.id) : null;
  const [account, sub] = target
    ? await Promise.all([
        db.user.findUnique({
          where: { id: target.id },
          select: {
            plan: true,
            subscriptionStatus: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
            stripeSubscriptionId: true,
          },
        }),
        getCurrentSimulatedSubscription(target.id),
      ])
    : [null, null];

  return (
    <div className="max-w-3xl space-y-6">
      <PageTitle
        title="Simulateur de paiement"
        intro="Phase de test : passer un compte en Premium ou en gratuit, avancer à l'échéance, faire échouer un renouvellement. Chaque action émet les mêmes évènements que Stripe, traités par le même code que le webhook."
        action={
          <Badge tone={active ? "warning" : "neutral"}>
            {active ? "Simulateur actif" : "Simulateur inactif"}
          </Badge>
        }
      />

      {!active ? (
        <p className="border-warning-line bg-warning-soft text-warning-ink rounded-lg border px-4 py-3 text-sm">
          {ERRORS.inactif}
        </p>
      ) : null}
      {query.introuvable ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink rounded-lg border px-4 py-3 text-sm"
        >
          Aucun compte avec cette adresse.
        </p>
      ) : null}
      {isAction(query.fait) ? (
        <p
          role="status"
          className="border-brand-line bg-brand-soft text-brand-ink rounded-lg border px-4 py-3 text-sm"
        >
          Fait : {ACTIONS[query.fait].label}.
        </p>
      ) : null}
      {query.erreur ? (
        <p
          role="alert"
          className="border-danger-line bg-danger-soft text-danger-ink rounded-lg border px-4 py-3 text-sm"
        >
          {ERRORS[query.erreur] ??
            (isAction(query.erreur)
              ? `Impossible dans l'état actuel : ${ACTIONS[query.erreur].label}.`
              : "Action impossible.")}
        </p>
      ) : null}

      <form action={findBillingUser} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="font-medium">Adresse e-mail du compte</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="off"
            className="border-line-strong mt-1 w-full rounded-lg border px-3 py-2"
          />
        </label>
        <button type="submit" className={button}>
          Rechercher
        </button>
      </form>

      {target && account && entitlements ? (
        <section className="border-line bg-surface rounded-2xl border p-4 text-sm sm:p-6">
          <h2 className="font-semibold break-all">{target.email}</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-subtle">Droits</dt>
            <dd>
              {entitlements.plan} ({entitlements.source})
            </dd>
            <dt className="text-ink-subtle">Offre enregistrée</dt>
            <dd>{account.plan}</dd>
            <dt className="text-ink-subtle">Statut</dt>
            <dd>{account.subscriptionStatus ?? "—"}</dd>
            <dt className="text-ink-subtle">Fin de période</dt>
            <dd>
              {account.currentPeriodEnd ? dateTime.format(account.currentPeriodEnd) : "—"}
              {account.cancelAtPeriodEnd ? " (résilié à l'échéance)" : ""}
            </dd>
            <dt className="text-ink-subtle">Abonnement</dt>
            <dd className="break-all">{account.stripeSubscriptionId ?? "—"}</dd>
            <dt className="text-ink-subtle">Simulé en cours</dt>
            <dd>
              {sub
                ? `${sub.status}${sub.cancelAtPeriodEnd ? ", résiliation demandée" : ""}`
                : "aucun"}
            </dd>
          </dl>
          {entitlements.source === "admin" ? (
            <p className="text-warning-ink mt-3">
              Compte administrateur : Premium d’office quel que soit l’abonnement. Tester le
              parcours avec un compte hors ADMIN_EMAILS.
            </p>
          ) : null}

          <ul className="mt-5 space-y-3">
            {(Object.keys(ACTIONS) as ActionKey[]).map((action) => (
              <li key={action}>
                <form
                  action={adminSimulatorAction}
                  className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
                >
                  <input type="hidden" name="userId" value={target.id} />
                  <input type="hidden" name="action" value={action} />
                  <button
                    type="submit"
                    disabled={!active}
                    className={`${button} disabled:opacity-50`}
                  >
                    {ACTIONS[action].label}
                  </button>
                  <span className="text-ink-subtle text-xs">{ACTIONS[action].hint}</span>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
