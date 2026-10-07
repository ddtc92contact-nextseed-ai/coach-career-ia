import "server-only";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/routing";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { smtpSender, smtpSettingsFromEnv, type MailSender } from "@/lib/mail/smtp";
import { matchingConfig } from "@/lib/matching/config";
import { employerEmail, type EmployerEmailKind } from "./email";
import { detectDiscriminatoryCriteria, postingText } from "./moderation";
import { applyPostingEvent, setOrganizationStatus, type TransitionOutcome } from "./publication";

/**
 * Modération (administrateurs uniquement, appelée après `requireAdmin()`) :
 * organisations en attente, offres en revue, suspension. Chaque décision est
 * envoyée par e-mail aux membres de l'organisation, avec le motif.
 */

export type ModerationDeps = { send: MailSender | null; appUrl: string | null };

let sender: MailSender | null | undefined;

export function moderationDeps(): ModerationDeps {
  if (sender === undefined) sender = smtpSender(smtpSettingsFromEnv());
  return { send: sender, appUrl: matchingConfig().appUrl };
}

/** File de modération : organisations en attente, offres en revue, organisations actives. */
export async function getModerationQueue() {
  const [pendingOrgs, reviewPostings, activeOrgs] = await Promise.all([
    db.organization.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        website: true,
        domain: true,
        sector: true,
        country: true,
        reviewNote: true,
        createdAt: true,
        members: {
          where: { role: "OWNER" },
          select: { user: { select: { email: true } } },
        },
      },
    }),
    db.jobPosting.findMany({
      where: { status: "IN_REVIEW" },
      orderBy: { updatedAt: "asc" },
      select: {
        id: true,
        flags: true,
        reviewNote: true,
        paidAt: true,
        updatedAt: true,
        organization: { select: { id: true, name: true, status: true } },
        offer: {
          select: {
            title: true,
            description: true,
            city: true,
            salaryMin: true,
            salaryMax: true,
            salaryCurrency: true,
            salaryPeriod: true,
          },
        },
      },
    }),
    db.organization.findMany({
      where: { status: { in: ["ACTIVE", "SUSPENDED"] } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: 200,
      select: {
        id: true,
        name: true,
        domain: true,
        status: true,
        reviewNote: true,
        _count: { select: { postings: { where: { status: "LIVE" } } } },
      },
    }),
  ]);
  return {
    pendingOrgs: pendingOrgs.map(({ members, ...org }) => ({
      ...org,
      ownerEmails: members.map((m) => m.user.email),
    })),
    reviewPostings: reviewPostings.map((p) => ({
      ...p,
      excerpts: detectDiscriminatoryCriteria(postingText(p.offer)),
    })),
    activeOrgs,
  };
}

/** Prévient les membres de l'organisation (dans leur langue). Un échec d'envoi n'annule rien. */
async function notifyMembers(
  orgId: string,
  kind: EmployerEmailKind,
  input: { title?: string; reason?: string | null; path: string },
  deps: ModerationDeps,
) {
  if (!deps.send || !deps.appUrl) {
    logger.warn("employer.email.skipped", { kind, reason: "smtpOrAppUrlMissing" });
    return;
  }
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      name: true,
      members: { select: { user: { select: { email: true, locale: true } } } },
    },
  });
  if (!org) return;
  for (const { user } of org.members) {
    const locale = isAppLocale(user.locale) ? user.locale : DEFAULT_LOCALE;
    const url = new URL(`/${locale}${input.path}`, deps.appUrl).toString();
    try {
      await deps.send({
        to: user.email,
        ...employerEmail(locale, kind, { orgName: org.name, ...input, url }),
      });
    } catch (error) {
      logger.error("employer.email.failed", { kind, orgId, error });
    }
  }
  logger.info("employer.email.sent", { kind, orgId, recipients: org.members.length });
}

export async function approveOrganization(
  adminId: string,
  orgId: string,
  deps: ModerationDeps = moderationDeps(),
): Promise<TransitionOutcome[] | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { status: true } });
  if (!org || org.status === "ACTIVE") return null;
  const outcomes = await db.$transaction((tx) => setOrganizationStatus(tx, orgId, "ACTIVE"));
  logger.info("employer.moderation.orgApproved", { adminId, orgId, published: outcomes.length });
  await notifyMembers(orgId, "orgApproved", { path: "/entreprise" }, deps);
  return outcomes;
}

/**
 * Refus d'une organisation en attente, ou suspension d'une organisation
 * active : statut `SUSPENDED`, motif enregistré, offres en ligne fermées.
 */
export async function suspendOrganization(
  adminId: string,
  orgId: string,
  reason: string,
  deps: ModerationDeps = moderationDeps(),
): Promise<TransitionOutcome[] | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { status: true } });
  if (!org || org.status === "SUSPENDED") return null;
  const outcomes = await db.$transaction((tx) =>
    setOrganizationStatus(tx, orgId, "SUSPENDED", { note: reason }),
  );
  const kind = org.status === "PENDING" ? "orgRejected" : "orgSuspended";
  logger.info("employer.moderation.orgSuspended", {
    adminId,
    orgId,
    kind,
    closed: outcomes.length,
  });
  await notifyMembers(orgId, kind, { reason, path: "/entreprise" }, deps);
  return outcomes;
}

async function postingDecision(
  adminId: string,
  postingId: string,
  event: { type: "approve" } | { type: "reject"; reason: string },
  deps: ModerationDeps,
): Promise<TransitionOutcome | null> {
  const posting = await db.jobPosting.findUnique({
    where: { id: postingId },
    select: { id: true, orgId: true, offer: { select: { title: true } } },
  });
  if (!posting) return null;
  const outcome = await db.$transaction((tx) => applyPostingEvent(tx, posting.id, event));
  if (!outcome) return null;
  logger.info("employer.moderation.posting", { adminId, ...outcome, event: event.type });
  await notifyMembers(
    posting.orgId,
    event.type === "approve" ? "postingApproved" : "postingRejected",
    {
      title: posting.offer.title,
      reason: event.type === "reject" ? event.reason : null,
      path: `/entreprise/offres/${posting.id}`,
    },
    deps,
  );
  return outcome;
}

export const approvePosting = (
  adminId: string,
  postingId: string,
  deps: ModerationDeps = moderationDeps(),
) => postingDecision(adminId, postingId, { type: "approve" }, deps);

export const rejectPosting = (
  adminId: string,
  postingId: string,
  reason: string,
  deps: ModerationDeps = moderationDeps(),
) => postingDecision(adminId, postingId, { type: "reject", reason }, deps);
