import { NextRequest } from "next/server";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/lib/auth/redirect";
import { simulatorPaymentEvent } from "@/lib/billing/simulator";
import { oneTimePaymentRef } from "@/lib/billing/webhook";
import {
  DEFAULT_JOB_POSTING_PRICE_CENTS,
  jobPostingPriceFromEnv,
  postingDurationDays,
} from "@/lib/employer/config";
import { checkMemberDomain, emailDomain, websiteDomain } from "@/lib/employer/domain";
import {
  offerStatusFor,
  transition,
  type LifecycleContext,
  type PostingState,
} from "@/lib/employer/lifecycle";
import { detectDiscriminatoryCriteria } from "@/lib/employer/moderation";
import { organizationInput, postingInput } from "@/lib/employer/schema";
import { detectSectors, offerSeniorityRank, SENIORITY_RANK } from "@/lib/matching/signals";
import { proxy } from "@/proxy";

const NOW = new Date("2026-10-07T10:00:00Z");
const DAY = 86_400_000;

describe("vérification du domaine de l'organisation", () => {
  it("extrait les domaines", () => {
    expect(emailDomain("Rh@Acme.FR")).toBe("acme.fr");
    expect(emailDomain("pas-une-adresse")).toBeNull();
    expect(websiteDomain("https://www.acme.fr/carrieres")).toBe("acme.fr");
    expect(websiteDomain("ftp://acme.fr")).toBeNull();
  });

  it("valide un e-mail du domaine du site (ou d'un sous-domaine)", () => {
    expect(checkMemberDomain("rh@acme.fr", "https://www.acme.fr")).toEqual({
      verified: true,
      domain: "acme.fr",
    });
    expect(checkMemberDomain("jean@rh.acme.fr", "https://acme.fr").verified).toBe(true);
    expect(checkMemberDomain("jean@acme.fr", "https://jobs.acme.fr").verified).toBe(true);
  });

  it("refuse les messageries grand public et les domaines différents", () => {
    expect(checkMemberDomain("acme.rh@gmail.com", "https://acme.fr")).toMatchObject({
      verified: false,
      reason: "webmail",
    });
    expect(checkMemberDomain("x@orange.fr", "https://orange.fr")).toMatchObject({
      verified: false,
      reason: "webmail",
    });
    expect(checkMemberDomain("rh@globex.fr", "https://acme.fr")).toMatchObject({
      verified: false,
      reason: "mismatch",
    });
    // « notacme.fr » n'est pas un sous-domaine de « acme.fr ».
    expect(checkMemberDomain("rh@notacme.fr", "https://acme.fr").verified).toBe(false);
  });
});

const validPosting = {
  title: "Data engineer",
  description: "Vous rejoignez l’équipe data. ".repeat(10),
  contractType: "CDI",
  remotePolicy: "HYBRID",
  city: "Paris",
  country: "FR",
  seniority: "SENIOR",
  sector: "SAAS_SOFTWARE",
  salaryMin: "55 000",
  salaryMax: "65000",
  salaryCurrency: "EUR",
  salaryPeriod: "YEAR",
};

describe("formulaire d'offre : salaire obligatoire", () => {
  it("accepte une offre complète (montants saisis librement)", () => {
    const parsed = postingInput.safeParse(validPosting);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.salaryMin).toBe(55000);
  });

  it.each(["salaryMin", "salaryMax", "salaryCurrency", "salaryPeriod"] as const)(
    "refuse une offre sans %s",
    (field) => {
      const parsed = postingInput.safeParse({ ...validPosting, [field]: "" });
      expect(parsed.success).toBe(false);
      const issue = parsed.error!.issues.find((i) => i.path[0] === field);
      expect(issue?.message).toMatch(/required|invalidChoice/);
    },
  );

  it("refuse une fourchette inversée ou non numérique", () => {
    const inverted = postingInput.safeParse({ ...validPosting, salaryMax: "40000" });
    expect(inverted.error?.issues[0]).toMatchObject({
      path: ["salaryMax"],
      message: "salaryRange",
    });
    const text = postingInput.safeParse({ ...validPosting, salaryMin: "à négocier" });
    expect(text.error?.issues[0]?.message).toBe("invalidNumber");
  });

  it("exige un télétravail explicite et une description suffisante", () => {
    expect(postingInput.safeParse({ ...validPosting, remotePolicy: "UNKNOWN" }).success).toBe(
      false,
    );
    expect(postingInput.safeParse({ ...validPosting, description: "Trop court" }).success).toBe(
      false,
    );
  });

  it("complète le site de l'organisation", () => {
    const parsed = organizationInput.parse({
      name: "Acme",
      website: "acme.fr",
      sector: "SAAS_SOFTWARE",
      size: "S51_200",
      country: "FR",
    });
    expect(parsed.website).toBe("https://acme.fr");
    expect(
      organizationInput.safeParse({ ...parsed, website: "pas un site" }).error?.issues[0]?.message,
    ).toBe("invalidUrl");
  });
});

describe("repérage des critères discriminatoires (signalement, jamais refus)", () => {
  const categories = (text: string) => detectDiscriminatoryCriteria(text).map((f) => f.category);

  it("signale âge, sexe, origine, situation familiale", () => {
    expect(categories("Profil de moins de 30 ans recherché")).toEqual(["age"]);
    expect(categories("Poste réservé : hommes uniquement")).toEqual(["sex"]);
    expect(categories("Candidat d'origine française de préférence")).toEqual(["origin"]);
    expect(categories("Idéalement célibataire et sans enfant")).toEqual(["family"]);
    expect(categories("Young person, female only, no children")).toEqual(["age", "sex", "family"]);
  });

  it("ne signale pas les formules d'usage", () => {
    expect(categories("Data engineer H/F (F/H/X) — 3 à 5 ans d'expérience")).toEqual([]);
    expect(categories("Plus de 10 ans d'expérience en Python")).toEqual([]);
    expect(
      categories("Nous recrutons sans distinction de sexe, d'âge, d'origine ou de religion."),
    ).toEqual([]);
    expect(categories("We hire regardless of gender, age or marital status.")).toEqual([]);
  });
});

const ctx = (orgStatus: LifecycleContext["orgStatus"] = "ACTIVE", now = NOW): LifecycleContext => ({
  orgStatus,
  now,
  durationDays: 30,
});
const draft: PostingState = {
  status: "DRAFT",
  paidAt: null,
  approvedAt: null,
  flags: [],
  reviewNote: null,
  publishedAt: null,
  expiresAt: null,
  closedAt: null,
};

describe("cycle de vie : paiement → modération → publication", () => {
  it("brouillon soumis → en attente de paiement (jamais en ligne sans paiement)", () => {
    const submitted = transition(draft, { type: "submit", flags: [] }, ctx())!;
    expect(submitted.status).toBe("AWAITING_PAYMENT");
    expect(offerStatusFor(submitted)).toBe("DRAFT");
  });

  it("paiement + rien de signalé + organisation active → en ligne 30 jours", () => {
    const submitted = transition(draft, { type: "submit", flags: [] }, ctx())!;
    const live = transition(submitted, { type: "paid" }, ctx())!;
    expect(live).toMatchObject({ status: "LIVE", paidAt: NOW, approvedAt: NOW, publishedAt: NOW });
    expect(live.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(offerStatusFor(live)).toBe("OPEN");
  });

  it("offre signalée → revue manuelle après paiement, puis approbation", () => {
    const submitted = transition(draft, { type: "submit", flags: ["age"] }, ctx())!;
    const paid = transition(submitted, { type: "paid" }, ctx())!;
    expect(paid).toMatchObject({ status: "IN_REVIEW", approvedAt: null });
    expect(offerStatusFor(paid)).toBe("DRAFT");
    expect(transition(paid, { type: "approve" }, ctx())!.status).toBe("LIVE");
  });

  it("organisation en attente : payée mais en revue, publiée à sa validation", () => {
    const submitted = transition(draft, { type: "submit", flags: [] }, ctx("PENDING"))!;
    const paid = transition(submitted, { type: "paid" }, ctx("PENDING"))!;
    expect(paid.status).toBe("IN_REVIEW");
    expect(transition(paid, { type: "orgChanged" }, ctx("PENDING"))).toBeNull();
    expect(transition(paid, { type: "orgChanged" }, ctx("ACTIVE"))!.status).toBe("LIVE");
  });

  it("approbation sans paiement : reste en attente de paiement", () => {
    const submitted = transition(draft, { type: "submit", flags: ["sex"] }, ctx())!;
    expect(transition(submitted, { type: "approve" }, ctx())).toBeNull();
  });

  it("refus avec motif : modifiable, le paiement est conservé, revue manuelle ensuite", () => {
    const paid = transition(
      transition(draft, { type: "submit", flags: ["family"] }, ctx())!,
      { type: "paid" },
      ctx(),
    )!;
    const rejected = transition(paid, { type: "reject", reason: "Critère familial" }, ctx())!;
    expect(rejected).toMatchObject({ status: "REJECTED", reviewNote: "Critère familial" });
    expect(rejected.paidAt).toEqual(NOW);
    const edited = transition(rejected, { type: "edit" }, ctx())!;
    expect(edited.status).toBe("DRAFT");
    // Plus rien de signalé, mais déjà refusée : pas d'approbation automatique.
    const resubmitted = transition(edited, { type: "submit", flags: [] }, ctx())!;
    expect(resubmitted.status).toBe("IN_REVIEW");
    expect(transition(resubmitted, { type: "approve" }, ctx())!.status).toBe("LIVE");
  });

  it("une offre en ligne ne peut être modifiée ; payer deux fois ne republie pas", () => {
    const live = transition(
      transition(draft, { type: "submit", flags: [] }, ctx())!,
      { type: "paid" },
      ctx(),
    )!;
    expect(transition(live, { type: "edit" }, ctx())).toBeNull();
    expect(transition(live, { type: "submit", flags: [] }, ctx())).toBeNull();
  });
});

describe("cycle de vie : échéance, fermeture, renouvellement, suspension", () => {
  const live = transition(
    transition(draft, { type: "submit", flags: [] }, ctx())!,
    { type: "paid" },
    ctx(),
  )!;

  it("ferme l'offre à l'échéance, pas avant", () => {
    expect(
      transition(live, { type: "expire" }, ctx("ACTIVE", new Date(NOW.getTime() + 29 * DAY))),
    ).toBeNull();
    const later = new Date(NOW.getTime() + 30 * DAY);
    const expired = transition(live, { type: "expire" }, ctx("ACTIVE", later))!;
    expect(expired).toMatchObject({ status: "CLOSED", paidAt: null, closedAt: later });
    expect(offerStatusFor(expired)).toBe("CLOSED");
  });

  it("fermeture anticipée par l'entreprise", () => {
    const closed = transition(live, { type: "close" }, ctx())!;
    expect(closed.status).toBe("CLOSED");
    expect(transition(closed, { type: "close" }, ctx())).toBeNull();
  });

  it("republication : nouveau paiement exigé, sans nouvelle revue", () => {
    const closed = transition(live, { type: "close" }, ctx())!;
    const renewed = transition(closed, { type: "renew" }, ctx())!;
    expect(renewed.status).toBe("AWAITING_PAYMENT");
    const later = new Date(NOW.getTime() + 40 * DAY);
    const relive = transition(renewed, { type: "paid" }, ctx("ACTIVE", later))!;
    expect(relive).toMatchObject({ status: "LIVE", publishedAt: later });
    expect(relive.expiresAt).toEqual(new Date(later.getTime() + 30 * DAY));
  });

  it("prolongation d'une offre en ligne : la période s'ajoute à l'échéance", () => {
    const extended = transition(
      live,
      { type: "paid" },
      ctx("ACTIVE", new Date(NOW.getTime() + DAY)),
    )!;
    expect(extended.status).toBe("LIVE");
    expect(extended.expiresAt).toEqual(new Date(NOW.getTime() + 60 * DAY));
  });

  it("suspension de l'organisation : offre fermée", () => {
    expect(transition(live, { type: "orgChanged" }, ctx("SUSPENDED"))!.status).toBe("CLOSED");
  });

  it("retrait d'une offre en ligne par la modération", () => {
    const rejected = transition(live, { type: "reject", reason: "Offre trompeuse" }, ctx())!;
    expect(rejected).toMatchObject({ status: "REJECTED", paidAt: null });
    expect(offerStatusFor(rejected)).toBe("CLOSED");
  });
});

describe("configuration de la publication", () => {
  it("prix et durée lus dans l'environnement, avec des valeurs par défaut fictives", () => {
    expect(jobPostingPriceFromEnv({})).toEqual({
      amountCents: DEFAULT_JOB_POSTING_PRICE_CENTS,
      currency: "EUR",
    });
    expect(
      jobPostingPriceFromEnv({ JOB_POSTING_PRICE_CENTS: "14900", JOB_POSTING_CURRENCY: "chf" }),
    ).toEqual({ amountCents: 14900, currency: "CHF" });
    expect(jobPostingPriceFromEnv({ JOB_POSTING_PRICE_CENTS: "-3" }).amountCents).toBe(
      DEFAULT_JOB_POSTING_PRICE_CENTS,
    );
    expect(postingDurationDays({})).toBe(30);
    expect(postingDurationDays({ JOB_POSTING_DURATION_DAYS: "45" })).toBe(45);
    expect(postingDurationDays({ JOB_POSTING_DURATION_DAYS: "0" })).toBe(30);
  });
});

describe("paiement unitaire : évènement Checkout mode=payment", () => {
  const event = (overrides: Record<string, unknown> = {}) => {
    const e = simulatorPaymentEvent(
      {
        checkoutSessionId: "sim_cs_1",
        userId: "u1",
        kind: "job_posting",
        paymentId: "pay_1",
        amountCents: 9900,
        currency: "EUR",
      },
      NOW,
    );
    Object.assign(e.data.object, overrides);
    return e as unknown as Stripe.Event;
  };

  it("lit l'achat depuis les métadonnées", () => {
    expect(oneTimePaymentRef(event())).toEqual({
      kind: "job_posting",
      paymentId: "pay_1",
      checkoutSessionId: "sim_cs_1",
      amountCents: 9900,
      currency: "EUR",
    });
  });

  it("ignore un paiement non abouti, un abonnement ou un type inconnu", () => {
    expect(oneTimePaymentRef(event({ payment_status: "unpaid" }))).toBeNull();
    expect(oneTimePaymentRef(event({ mode: "subscription" }))).toBeNull();
    expect(oneTimePaymentRef(event({ metadata: { kind: "autre", paymentId: "x" } }))).toBeNull();
  });
});

describe("matching : codes des offres directes", () => {
  it("reconnaît secteur et séniorité saisis comme codes", () => {
    expect(detectSectors("GAMBLING")).toEqual(["GAMBLING"]);
    expect(offerSeniorityRank("Ingénieur données", "SENIOR")).toBe(SENIORITY_RANK.SENIOR);
  });
});

describe("accès à l'espace entreprise", () => {
  const location = (response: Response) => {
    const value = response.headers.get("location");
    return value ? new URL(value).pathname + new URL(value).search : null;
  };

  it("sans session, renvoie vers la connexion en gardant la page entreprise", () => {
    const response = proxy(new NextRequest("http://localhost/fr/entreprise/offres/nouvelle"));
    expect(location(response)).toBe("/fr/connexion?callbackUrl=%2Fentreprise%2Foffres%2Fnouvelle");
  });

  it("laisse la page « Je recrute » publique", () => {
    const response = proxy(new NextRequest("http://localhost/de/entreprise/inscription"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("accepte /entreprise comme destination après connexion, pas un autre chemin", () => {
    expect(safeCallbackUrl("/entreprise/inscription")).toBe("/entreprise/inscription");
    expect(safeCallbackUrl("/entreprises")).toBe("/app");
    expect(safeCallbackUrl("//entreprise")).toBe("/app");
  });
});
