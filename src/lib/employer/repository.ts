import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { CurrentUser } from "@/lib/auth/session";
import { isAdminEmail } from "@/lib/auth/admin-emails";
import { getBillingProvider, type BillingRedirect } from "@/lib/billing/provider";
import { db } from "@/lib/db";
import { locateOfferPlace } from "@/lib/geo/server";
import { logger } from "@/lib/logger";
import { DIRECT_SOURCE, directSourceKey, jobPostingPriceFromEnv } from "./config";
import { checkMemberDomain } from "./domain";
import { canPay, isEditable, type PostingStatus } from "./lifecycle";
import { detectDiscriminatoryCriteria, postingText } from "./moderation";
import { applyPostingEvent, expireDirectPostings, type TransitionOutcome } from "./publication";
import type { OrganizationInput, PostingInput } from "./schema";

/**
 * Accès aux données de l'espace entreprise. Chaque fonction reçoit
 * l'organisation de l'utilisateur courant (`requireEmployer()`) et filtre par
 * elle : l'offre d'une autre organisation est traitée comme inexistante
 * (`null` → 404). Aucune fonction ne lit de donnée candidat : une entreprise
 * ne voit que ses offres, leur statut et un nombre de consultations.
 */

export type Membership = NonNullable<Awaited<ReturnType<typeof getMembership>>>;

/** Organisation de l'utilisateur (la première, v1 : une organisation par compte). */
export function getMembership(userId: string) {
  return db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          name: true,
          website: true,
          domain: true,
          sector: true,
          size: true,
          country: true,
          status: true,
          verifiedAt: true,
          reviewNote: true,
          companyId: true,
        },
      },
    },
  });
}

export type Organization = Membership["organization"];

// --- Organisation -------------------------------------------------------------

export type CreateOrganizationResult =
  { ok: true; orgId: string; status: "ACTIVE" | "PENDING" } | { ok: false; error: "alreadyMember" };

/**
 * Inscription « Je recrute » : crée l'organisation, sa fiche entreprise et
 * l'adhésion du compte (propriétaire). Active d'emblée si le domaine de
 * l'e-mail correspond à celui du site (et qu'aucune organisation active ne
 * l'occupe déjà), sinon en attente de validation par un administrateur.
 */
export async function createOrganization(
  user: CurrentUser,
  input: OrganizationInput,
  now: Date = new Date(),
): Promise<CreateOrganizationResult> {
  if (await getMembership(user.id)) return { ok: false, error: "alreadyMember" };
  const check = checkMemberDomain(user.email, input.website);
  const domain = check.domain ?? "";
  const taken =
    check.verified && (await db.organization.count({ where: { domain, status: "ACTIVE" } })) > 0;
  const status = check.verified && !taken ? "ACTIVE" : "PENDING";

  const org = await db.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        slug: `direct-${randomUUID()}`,
        name: input.name,
        website: input.website,
        sector: input.sector,
      },
      select: { id: true },
    });
    return tx.organization.create({
      data: {
        name: input.name,
        website: input.website,
        domain,
        sector: input.sector,
        size: input.size,
        country: input.country,
        status,
        verifiedAt: status === "ACTIVE" ? now : null,
        companyId: company.id,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
      select: { id: true },
    });
  });
  logger.info("employer.organization.created", {
    orgId: org.id,
    status,
    check: check.verified ? (taken ? "domainTaken" : "verified") : check.reason,
  });
  return { ok: true, orgId: org.id, status };
}

// --- Offres -------------------------------------------------------------------

const postingListSelect = {
  id: true,
  status: true,
  expiresAt: true,
  publishedAt: true,
  viewCount: true,
  updatedAt: true,
  offer: { select: { title: true, city: true } },
} as const;

/** Offres de l'organisation (échéances passées appliquées d'abord). */
export async function listPostings(orgId: string) {
  await expireDirectPostings(db, { orgId }).catch((error: unknown) =>
    logger.error("employer.postings.expireFailed", { orgId, error }),
  );
  return db.jobPosting.findMany({
    where: { orgId },
    orderBy: { updatedAt: "desc" },
    select: postingListSelect,
  });
}

const postingDetailSelect = {
  id: true,
  orgId: true,
  offerId: true,
  status: true,
  paidAt: true,
  approvedAt: true,
  flags: true,
  reviewNote: true,
  publishedAt: true,
  expiresAt: true,
  closedAt: true,
  viewCount: true,
  createdAt: true,
  offer: {
    select: {
      title: true,
      description: true,
      contractType: true,
      remotePolicy: true,
      city: true,
      country: true,
      latitude: true,
      seniority: true,
      sector: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
    },
  },
} as const;

/** Une offre de l'organisation, ou `null` (autre organisation, inexistante). */
export async function getPosting(orgId: string, postingId: string) {
  if (typeof postingId !== "string" || postingId.length > 64) return null;
  const row = await db.jobPosting.findFirst({
    where: { id: postingId, orgId },
    select: postingDetailSelect,
  });
  if (!row) return null;
  return {
    ...row,
    offer: {
      ...row.offer,
      salaryMin: row.offer.salaryMin === null ? null : Number(row.offer.salaryMin),
      salaryMax: row.offer.salaryMax === null ? null : Number(row.offer.salaryMax),
    },
  };
}
export type PostingView = NonNullable<Awaited<ReturnType<typeof getPosting>>>;

function offerFields(input: PostingInput, org: Organization) {
  return {
    title: input.title,
    description: input.description,
    companyName: org.name,
    companyId: org.companyId,
    city: input.city,
    region: null,
    country: input.country,
    remotePolicy: input.remotePolicy,
    contractType: input.contractType,
    contractLabel: null,
    salaryMin: input.salaryMin,
    salaryMax: input.salaryMax,
    salaryCurrency: input.salaryCurrency,
    salaryPeriod: input.salaryPeriod,
    salaryRaw: null,
    // Codes (`src/lib/career/codes.ts`) : reconnus tels quels par le matching.
    sector: input.sector,
    seniority: input.seniority,
    contentHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  };
}

/**
 * Nouveau brouillon : la ligne `job_offers` (`source = "direct"`, statut
 * `DRAFT`, jamais lue par le matching) et sa publication.
 */
export async function createPosting(
  org: Organization,
  input: PostingInput,
  now: Date = new Date(),
): Promise<string> {
  const geo = await locateOfferPlace({ city: input.city, country: input.country }, now);
  const sourceId = randomUUID();
  const posting = await db.$transaction(async (tx) => {
    const offer = await tx.jobOffer.create({
      data: {
        ...offerFields(input, org),
        ...geo,
        source: DIRECT_SOURCE,
        sourceKey: directSourceKey(org.id),
        sourceId,
        url: org.website,
        urlKey: `${DIRECT_SOURCE}:${sourceId}`,
        dedupKey: null,
        status: "DRAFT",
        firstSeenAt: now,
        lastSeenAt: now,
      },
      select: { id: true },
    });
    return tx.jobPosting.create({
      data: { orgId: org.id, offerId: offer.id },
      select: { id: true },
    });
  });
  logger.info("employer.posting.created", { orgId: org.id, postingId: posting.id });
  return posting.id;
}

export type PostingActionResult =
  { ok: true; outcome?: TransitionOutcome } | { ok: false; error: "notFound" | "notAllowed" };

/** Modification du contenu (brouillon, refusée, en attente de paiement, fermée). */
export async function updatePosting(
  org: Organization,
  postingId: string,
  input: PostingInput,
  now: Date = new Date(),
): Promise<PostingActionResult> {
  const posting = await getPosting(org.id, postingId);
  if (!posting) return { ok: false, error: "notFound" };
  if (!isEditable(posting.status)) return { ok: false, error: "notAllowed" };
  const placeChanged = posting.offer.city !== input.city || posting.offer.country !== input.country;
  const geo = placeChanged
    ? await locateOfferPlace({ city: input.city, country: input.country }, now)
    : {};
  const outcome = await db.$transaction(async (tx) => {
    await tx.jobOffer.update({
      where: { id: posting.offerId },
      data: { ...offerFields(input, org), ...geo },
    });
    return posting.status === "DRAFT"
      ? null
      : applyPostingEvent(tx, posting.id, { type: "edit" }, { now });
  });
  return { ok: true, outcome: outcome ?? undefined };
}

/** Suppression d'un brouillon jamais publié ni payé. */
export async function deleteDraft(orgId: string, postingId: string): Promise<boolean> {
  const posting = await db.jobPosting.findFirst({
    where: {
      id: postingId,
      orgId,
      status: "DRAFT",
      publishedAt: null,
      paidAt: null,
      payments: { none: { status: "PAID" } },
    },
    select: { offerId: true },
  });
  if (!posting) return false;
  // La publication suit l'offre (suppression en cascade).
  await db.jobOffer.delete({ where: { id: posting.offerId } });
  return true;
}

async function postingEvent(
  orgId: string,
  postingId: string,
  event: Parameters<typeof applyPostingEvent>[2],
): Promise<PostingActionResult> {
  const posting = await db.jobPosting.findFirst({
    where: { id: postingId, orgId },
    select: { id: true },
  });
  if (!posting) return { ok: false, error: "notFound" };
  const outcome = await db.$transaction((tx) => applyPostingEvent(tx, posting.id, event));
  if (!outcome) return { ok: false, error: "notAllowed" };
  logger.info("employer.posting.transition", { ...outcome, event: event.type });
  return { ok: true, outcome };
}

/**
 * Soumission d'un brouillon : repérage des critères discriminatoires (qui
 * imposent une revue manuelle, sans refus automatique), puis paiement.
 */
export async function submitPosting(orgId: string, postingId: string) {
  const posting = await getPosting(orgId, postingId);
  if (!posting) return { ok: false, error: "notFound" } as const;
  const flags = detectDiscriminatoryCriteria(postingText(posting.offer)).map((f) => f.category);
  return postingEvent(orgId, postingId, { type: "submit", flags });
}

export const closePosting = (orgId: string, postingId: string) =>
  postingEvent(orgId, postingId, { type: "close" });

export const renewPosting = (orgId: string, postingId: string) =>
  postingEvent(orgId, postingId, { type: "renew" });

// --- Paiement -----------------------------------------------------------------

export type CheckoutResult =
  | { ok: true; redirect: BillingRedirect }
  | { ok: false; error: "notFound" | "notAllowed" | "unavailable" | "suspended" };

/**
 * Ouvre le paiement d'une publication (ou d'un renouvellement d'une offre en
 * ligne) : l'achat est enregistré (`PENDING`) puis la page de paiement du
 * fournisseur ouverte. Seul le traitement de l'évènement de paiement
 * (webhook ou simulateur) fait avancer l'offre.
 */
export async function startPostingCheckout(
  user: CurrentUser,
  org: Organization,
  postingId: string,
  locale: string,
): Promise<CheckoutResult> {
  if (org.status === "SUSPENDED") return { ok: false, error: "suspended" };
  const posting = await getPosting(org.id, postingId);
  if (!posting) return { ok: false, error: "notFound" };
  if (!canPay(posting.status)) return { ok: false, error: "notAllowed" };
  const provider = getBillingProvider();
  if (!provider) return { ok: false, error: "unavailable" };

  const price = jobPostingPriceFromEnv();
  // Un seul achat en attente par offre : le précédent est abandonné.
  await db.jobPostingPayment.updateMany({
    where: { postingId: posting.id, status: "PENDING" },
    data: { status: "CANCELED" },
  });
  const payment = await db.jobPostingPayment.create({
    data: {
      postingId: posting.id,
      orgId: org.id,
      userId: user.id,
      provider: provider.name,
      amountCents: price.amountCents,
      currency: price.currency,
    },
    select: { id: true },
  });
  const checkout = await provider.createJobPostingCheckout({
    user,
    paymentId: payment.id,
    postingId: posting.id,
    amountCents: price.amountCents,
    currency: price.currency,
    label: posting.offer.title,
    locale,
  });
  if (!checkout) {
    await db.jobPostingPayment.update({
      where: { id: payment.id },
      data: { status: "CANCELED" },
    });
    return { ok: false, error: "unavailable" };
  }
  await db.jobPostingPayment.update({
    where: { id: payment.id },
    data: { checkoutSessionId: checkout.checkoutSessionId },
  });
  logger.info("employer.payment.started", {
    orgId: org.id,
    postingId: posting.id,
    provider: provider.name,
  });
  return { ok: true, redirect: checkout.redirect };
}

/**
 * Publication offerte par un administrateur (`ADMIN_EMAILS`) : achat à 0 €
 * enregistré, offre payée et approuvée (l'administrateur est le modérateur).
 * L'organisation doit être active pour que l'offre passe en ligne.
 */
export async function publishFreeAsAdmin(
  user: CurrentUser,
  orgId: string,
  postingId: string,
  now: Date = new Date(),
): Promise<PostingActionResult> {
  if (!isAdminEmail(user.email)) return { ok: false, error: "notAllowed" };
  const posting = await db.jobPosting.findFirst({
    where: { id: postingId, orgId },
    select: { id: true, status: true },
  });
  if (!posting) return { ok: false, error: "notFound" };
  if (!canPay(posting.status)) return { ok: false, error: "notAllowed" };
  const outcome = await db.$transaction(async (tx) => {
    await tx.jobPostingPayment.create({
      data: {
        postingId: posting.id,
        orgId,
        userId: user.id,
        provider: "admin",
        amountCents: 0,
        currency: jobPostingPriceFromEnv().currency,
        status: "PAID",
        paidAt: now,
      },
    });
    const paid = await applyPostingEvent(tx, posting.id, { type: "paid" }, { now });
    if (paid?.to !== "IN_REVIEW") return paid;
    return (await applyPostingEvent(tx, posting.id, { type: "approve" }, { now })) ?? paid;
  });
  logger.info("employer.posting.adminPublished", { orgId, postingId, to: outcome?.to });
  return outcome ? { ok: true, outcome } : { ok: false, error: "notAllowed" };
}

export type { PostingStatus };
