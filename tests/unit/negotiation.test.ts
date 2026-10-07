import { describe, expect, it } from "vitest";
import { AiError, createAiClient, createMockProvider } from "@/lib/ai";
import { routing, type AppLocale } from "@/i18n/routing";
import { entitlementsFor, hasFeature } from "@/lib/billing/entitlements";
import { analyseOffer } from "@/lib/negotiation/analysis";
import { allowedFigures, checkOutgoing } from "@/lib/negotiation/check";
import {
  buildNegotiationDraft,
  identityIssues,
  ruleClosingBody,
  ruleCounterBody,
  type NegotiationFacts,
} from "@/lib/negotiation/draft";
import {
  negotiationDisclosure,
  negotiationEmail,
  negotiationPasteText,
} from "@/lib/negotiation/email";
import { claimsIn, findAmounts, remoteDaysIn, salaryAmounts } from "@/lib/negotiation/figures";
import { mandateFromForm, parseMandate, type Mandate } from "@/lib/negotiation/mandate";
import {
  mandateHints,
  marketFigures,
  marketForNegotiation,
  type MarketBenchmark,
} from "@/lib/negotiation/market";

// Données fictives uniquement : aucun profil réel n'est envoyé à un fournisseur.
const MANDATE: Mandate = {
  salaryFloor: 55_000,
  salaryTarget: 62_000,
  remoteDaysMin: 2,
  location: "Lyon",
  contractType: "CDI",
  startDate: "2027-01-04",
  title: null,
  otherPoints: ["Pas d’astreinte le week-end"],
  niceToHave: ["Budget formation"],
  facts: null,
};

function facts(overrides: Partial<NegotiationFacts> = {}): NegotiationFacts {
  return {
    locale: "fr",
    offerTitle: "Data engineer (H/F)",
    companyName: "Initrode",
    mandate: MANDATE,
    companyMessages: [
      "Bonjour, nous pouvons proposer 58 000 € brut annuel en CDI, avec 2 jours de télétravail par semaine.",
    ],
    analysis: null,
    offerSalary: { min: 55_000, max: 65_000 },
    outcome: "ACTIVE",
    ...overrides,
  };
}

function aiReplying(body: string | { error: AiError } | { delayMs: number; content: string }) {
  const provider = createMockProvider({
    respond: () => (typeof body === "string" ? JSON.stringify({ body }) : body),
  });
  return { provider, client: createAiClient({ provider, sleep: async () => {}, backoffMs: 0 }) };
}

const CONTEXT = { terms: ["Testard"], revealed: false };

describe("négociation : lecture des chiffres", () => {
  it("reconnaît montants, « k », mois et fourchettes ; ignore années et codes postaux", () => {
    expect(findAmounts("Nous proposons 58 000 € brut.").map((a) => a.annual)).toEqual([58_000]);
    expect(findAmounts("Budget : 55k€ à 60k").map((a) => a.annual)).toEqual([55_000, 60_000]);
    expect(salaryAmounts("We offer €65,000 per year")).toEqual([65_000]);
    expect(salaryAmounts("Wir bieten 60.000 € brutto")).toEqual([60_000]);
    expect(salaryAmounts("3 500 € brut par mois")).toEqual([42_000]);
    expect(salaryAmounts("fourchette 55-60k")).toEqual([55_000, 60_000]);
    expect(salaryAmounts("Démarrage en 2027, bureaux au 75008 Paris, 2 jours")).toEqual([]);
    // Taux journalier : pas un salaire annuel.
    expect(salaryAmounts("TJM 600 € par jour")).toEqual([]);
  });

  it("jours de télétravail dans les six langues", () => {
    expect(remoteDaysIn("avec 2 jours de télétravail par semaine")).toBe(2);
    expect(remoteDaysIn("at least 3 days of remote work per week")).toBe(3);
    expect(remoteDaysIn("mindestens 1 Tag Homeoffice pro Woche")).toBe(1);
    expect(remoteDaysIn("almeno 2 giorni di smart working")).toBe(2);
    expect(remoteDaysIn("minstens 2 dagen thuiswerken")).toBe(2);
    expect(remoteDaysIn("al menos 2 días de teletrabajo")).toBe(2);
    expect(remoteDaysIn("Poste en full remote")).toBe(5);
    expect(remoteDaysIn("Poste 100 % présentiel")).toBe(0);
    expect(remoteDaysIn("Rémunération de 60 000 €")).toBeNull();
  });

  it("offre concurrente et salaire actuel repérés, sauf à la forme négative", () => {
    expect(claimsIn("Elle a reçu une autre offre plus élevée.")).toEqual(["competingOffer"]);
    expect(claimsIn("The candidate has a competing offer.")).toEqual(["competingOffer"]);
    expect(claimsIn("Son salaire actuel est de 50 000 €.")).toEqual(["currentSalary"]);
    expect(claimsIn("Sie hat ein Konkurrenzangebot erhalten.")).toEqual(["competingOffer"]);
    expect(claimsIn("Elle n’a pas d’autre offre en cours.")).toEqual([]);
  });
});

describe("négociation : contrôle bloquant des messages", () => {
  it("bloque un montant sous le plancher, même cité", () => {
    expect(checkOutgoing("Elle accepterait 50 000 € brut annuel.", MANDATE)).toMatchObject([
      { code: "belowFloor", excerpt: "50 000 €" },
    ]);
    expect(checkOutgoing("Vous proposez 52k, elle souhaite 62k.", MANDATE)).toMatchObject([
      { code: "belowFloor" },
    ]);
    expect(checkOutgoing("Elle souhaite 62 000 € brut annuel.", MANDATE)).toEqual([]);
    // Montant mensuel annualisé sous le plancher.
    expect(checkOutgoing("Elle accepte 4 000 € brut par mois.", MANDATE)[0]?.code).toBe(
      "belowFloor",
    );
  });

  it("bloque la concession d'un point non négociable, pas son rappel", () => {
    expect(checkOutgoing("Elle peut se contenter d’1 jour de télétravail.", MANDATE)).toMatchObject(
      [{ code: "remoteDays" }],
    );
    expect(
      checkOutgoing("Elle peut se contenter d'un jour de télétravail.", MANDATE),
    ).toMatchObject([{ code: "remoteDays" }]);
    expect(checkOutgoing("Elle souhaite 3 jours de télétravail.", MANDATE)).toEqual([]);
    expect(checkOutgoing("Un CDD de 12 mois lui conviendrait.", MANDATE)).toMatchObject([
      { code: "contractType" },
    ]);
    expect(checkOutgoing("Elle ne souhaite pas de CDD.", MANDATE)).toEqual([]);
    expect(checkOutgoing("Elle tient à 2 jours de télétravail et à un CDI.", MANDATE)).toEqual([]);
  });

  it("une phrase négative ne contourne pas le contrôle des points non négociables", () => {
    const codes = (text: string) => checkOutgoing(text, MANDATE).map((i) => i.code);
    for (const text of [
      "Elle accepte qu'il n'y ait pas de télétravail.",
      "Elle accepte un poste sans télétravail.",
      "The candidate accepts no remote work.",
      "Die Kandidatin akzeptiert kein Homeoffice.",
      "La candidata acepta un puesto sin teletrabajo.",
      "De kandidaat accepteert geen thuiswerk.",
      "1 jour de télétravail, pas plus.",
      "Un seul jour de télétravail lui conviendrait.",
      "Elle accepte d'être sur site à temps plein.",
      "Elle accepte au moins 1 jour de télétravail.",
    ]) {
      expect(codes(text), text).toContain("remoteDays");
    }
    for (const text of [
      "Elle accepte un CDD et non un CDI.",
      "Elle ne demande pas de télétravail particulier, mais un CDD lui irait.",
      "Elle accepte de renoncer au CDI : pas de CDI, donc.",
    ]) {
      expect(codes(text), text).toContain("contractType");
    }
    // Rappels et refus explicites : autorisés.
    for (const text of [
      "Elle demande au moins 2 jours de télétravail.",
      "Elle ne descendra pas en dessous de 2 jours de télétravail par semaine.",
      "Pas moins de 2 jours de télétravail par semaine.",
      "Not fewer than 2 remote days per week.",
      "Pas de CDD, uniquement un CDI.",
      "Elle n'acceptera ni CDD ni intérim : un CDI uniquement.",
      "Elle refuse un CDD.",
    ]) {
      expect(codes(text), text).toEqual([]);
    }
  });

  it("anti-bluff : offre concurrente ou salaire actuel non déclarés au mandat", () => {
    const bluff = "Elle a reçu une autre offre à 70 000 €, merci d’en tenir compte.";
    expect(checkOutgoing(bluff, MANDATE).map((i) => i.code)).toEqual(["competingOffer"]);
    expect(checkOutgoing("Son salaire actuel est de 60 000 €.", MANDATE)[0]?.code).toBe(
      "currentSalary",
    );
    // Déclarée par le candidat dans son mandat : l'agent peut la mentionner.
    const declared = { ...MANDATE, facts: "J’ai une autre offre à 70 000 € chez un concurrent." };
    expect(checkOutgoing(bluff, declared)).toEqual([]);
  });

  it("chiffre inventé par l'IA : rejeté ; chiffres du mandat ou de l'entreprise : acceptés", () => {
    const allowed = allowedFigures(MANDATE, facts().companyMessages, [55_000, 65_000]);
    expect(
      checkOutgoing("Elle souhaite 62 000 € (vous proposez 58 000 €).", MANDATE, { allowed }),
    ).toEqual([]);
    expect(checkOutgoing("Elle souhaite 64 500 € brut.", MANDATE, { allowed })).toMatchObject([
      { code: "inventedFigure", excerpt: "64 500 €" },
    ]);
    expect(
      checkOutgoing("Soit une hausse de 12 % sur votre offre.", MANDATE, { allowed }),
    ).toMatchObject([{ code: "inventedFigure" }]);
  });
});

describe("négociation : brouillons", () => {
  it("les modèles déterministes passent les contrôles dans les six langues", () => {
    for (const locale of routing.locales as readonly AppLocale[]) {
      const f = facts({ locale });
      const counter = ruleCounterBody(f);
      const allowed = allowedFigures(MANDATE, f.companyMessages, [55_000, 65_000]);
      expect(checkOutgoing(counter, MANDATE, { allowed }), `${locale}: ${counter}`).toEqual([]);
      expect(identityIssues(counter, CONTEXT.terms, f), locale).toEqual([]);
      // La cible (pas le plancher) est demandée.
      expect(salaryAmounts(counter), locale).toEqual([62_000]);
      for (const outcome of ["ACCEPTED", "DECLINED", "PAUSED"] as const) {
        const closing = ruleClosingBody({ ...f, outcome });
        expect(checkOutgoing(closing, MANDATE, { allowed }), `${locale} ${outcome}`).toEqual([]);
      }
    }
  });

  it("texte de l'IA conforme : utilisé tel quel ; le prompt ne contient que le mandat et l'offre", async () => {
    const body =
      "Bonjour,\n\nMerci pour votre proposition de 58 000 €. La personne candidate souhaite 62 000 € brut annuel, en CDI, avec 2 jours de télétravail par semaine.\n\nBien cordialement,";
    const ai = aiReplying(body);
    const draft = await buildNegotiationDraft("counter", facts(), ai.client, CONTEXT);
    expect(draft).toEqual({ body, source: "llm" });
    const call = ai.provider.calls[0]!;
    expect(call.purpose).toBe("negotiation.counter");
    const prompt = JSON.stringify(call.messages);
    expect(prompt).toContain("salaryFloorNeverGoBelowAndNeverMention");
    expect(prompt).toMatch(/Never invent a competing offer/);
  });

  it("bluff, chiffre inventé ou identité dans le texte de l'IA : repli sur le modèle", async () => {
    for (const body of [
      "Bonjour,\n\nElle a reçu une autre offre à 70 000 € et souhaite donc 62 000 €.\n\nCordialement,",
      "Bonjour,\n\nElle souhaite 66 000 € brut annuel, en CDI, avec 2 jours de télétravail.\n\nCordialement,",
      "Bonjour,\n\nElle accepterait 50 000 € pour démarrer rapidement, en CDI.\n\nCordialement,",
      "Bonjour,\n\nMme Testard souhaite 62 000 € brut annuel, en CDI et 2 jours de télétravail.\n\nCordialement,",
    ]) {
      const draft = await buildNegotiationDraft(
        "counter",
        facts(),
        aiReplying(body).client,
        CONTEXT,
      );
      expect(draft.source, body).toBe("rules");
      expect(draft.fallback).toBe("check");
      expect(draft.body).toBe(ruleCounterBody(facts()));
    }
  });

  it("fournisseur en panne ou trop lent : erreur visible et repli, sans attente infinie", async () => {
    const down = await buildNegotiationDraft(
      "counter",
      facts(),
      aiReplying({ error: new AiError("unavailable") }).client,
      CONTEXT,
    );
    expect(down).toMatchObject({ source: "rules", fallback: "unavailable" });

    const started = Date.now();
    const slow = await buildNegotiationDraft(
      "counter",
      facts(),
      aiReplying({ delayMs: 10_000, content: "{}" }).client,
      CONTEXT,
      { timeoutMs: 50 },
    );
    expect(slow).toMatchObject({ source: "rules", fallback: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_000);

    // Sans IA configurée : modèle directement, sans code d'erreur.
    expect(
      await buildNegotiationDraft("closing", facts({ outcome: "DECLINED" }), null, CONTEXT),
    ).toEqual({ body: ruleClosingBody(facts({ outcome: "DECLINED" })), source: "rules" });
  });
});

describe("négociation : transparence (AI Act, art. 50)", () => {
  const link = {
    replyUrl: "https://coach.exemple.test/fr/p/x/repondre",
    expiresAt: new Date("2026-11-06"),
  };

  it("la mention « rédigé par l'assistant IA, approuvé par le candidat » est toujours ajoutée", () => {
    for (const locale of routing.locales as readonly AppLocale[]) {
      const disclosure = negotiationDisclosure(locale);
      expect(disclosure.length).toBeGreaterThan(40);
      const mail = negotiationEmail(locale, { offerTitle: "Data engineer", body: "Bonjour" }, link);
      expect(mail.text).toContain(disclosure);
      expect(mail.html).toContain(disclosure.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
      expect(mail.text).toContain(link.replyUrl);
      expect(mail.headers).toMatchObject({ "X-AI-Generated": "ai-drafted; human-approved" });
      expect(negotiationPasteText(locale, "Bonjour", link)).toContain(disclosure);
    }
    expect(negotiationDisclosure("fr")).toMatch(/assistant IA.*approuvé/);
    expect(negotiationDisclosure("en")).toMatch(/AI assistant.*approved/);
  });
});

describe("négociation : mandat et analyse", () => {
  it("formulaire → mandat validé ; cible sous le plancher refusée", () => {
    const form: Record<string, string> = {
      salaryFloor: "55k",
      salaryTarget: "62 000",
      remoteDaysMin: "2",
      contractType: "CDI",
      otherPoints: "- Pas d’astreinte\n\n• Mutuelle",
      niceToHave: "",
      facts: "",
      location: "",
      startDate: "2027-01-04",
      title: "",
    };
    const parsed = parseMandate(mandateFromForm((name) => form[name]));
    expect(parsed).toMatchObject({
      ok: true,
      mandate: {
        salaryFloor: 55_000,
        salaryTarget: 62_000,
        otherPoints: ["Pas d’astreinte", "Mutuelle"],
        location: null,
      },
    });
    const bad: Record<string, string> = { ...form, salaryTarget: "50000", remoteDaysMin: "7" };
    const invalid = parseMandate(mandateFromForm((name) => bad[name]));
    expect(invalid).toEqual({ ok: false, fields: ["remoteDaysMin", "salaryTarget"] });
  });

  it("analyse de la proposition : plancher, cible, télétravail, contrat (estimation)", () => {
    expect(analyseOffer(facts().companyMessages[0]!, MANDATE)).toEqual({
      salary: { offered: 58_000, status: "aboveFloor" },
      remote: { offered: 2, status: "met" },
      contract: { offered: "CDI", status: "met" },
      unchecked: 3,
    });
    const low = analyseOffer("Nous proposons 50k en CDD, 1 jour de télétravail.", MANDATE);
    expect(low).toMatchObject({
      salary: { status: "belowFloor" },
      remote: { status: "notMet" },
      contract: { offered: "CDD", status: "notMet" },
    });
    expect(analyseOffer("Merci, revenons vers vous.", MANDATE).salary.status).toBe("unknown");
  });

  it("droit `negotiation` : Premium et administrateurs, pas l'offre gratuite", () => {
    expect(
      hasFeature(entitlementsFor({ email: "a@exemple.test", plan: "FREE" }, {}), "negotiation"),
    ).toBe(false);
    expect(
      hasFeature(entitlementsFor({ email: "a@exemple.test", plan: "PREMIUM" }, {}), "negotiation"),
    ).toBe(true);
    expect(
      hasFeature(
        entitlementsFor(
          { email: "gerant@exemple.test", plan: "FREE" },
          { ADMIN_EMAILS: "gerant@exemple.test" },
        ),
        "negotiation",
      ),
    ).toBe(true);
  });
});

// Repère fictif (offres publiées), au-dessus du plancher de MANDATE.
const MARKET: MarketBenchmark = {
  p25: 56_000,
  median: 61_000,
  p75: 67_000,
  sampleSize: 24,
  scope: "REGION",
  area: "Auvergne-Rhône-Alpes",
};

describe("négociation : repère du marché (offres publiées)", () => {
  const withMarket = (overrides: Partial<NegotiationFacts> = {}) =>
    facts({ market: MARKET, ...overrides });
  const allowedWith = (f: NegotiationFacts) =>
    allowedFigures(f.mandate, f.companyMessages, [55_000, 65_000], marketFigures(f.market ?? null));

  it("seuil d'échantillon : sous le seuil, aucun repère ni chiffre", () => {
    expect(marketForNegotiation(MARKET, 10)).toBe(MARKET);
    expect(marketForNegotiation({ ...MARKET, sampleSize: 9 }, 10)).toBeNull();
    expect(marketForNegotiation(null, 10)).toBeNull();
    expect(marketFigures(null)).toEqual([]);
  });

  it("conseils du mandat : cible hors p25–p75, plancher au-dessus du maximum de l'offre", () => {
    expect(mandateHints({ salaryFloor: 55_000, salaryTarget: 62_000 }, MARKET, 65_000)).toEqual([]);
    expect(mandateHints({ salaryFloor: 50_000, salaryTarget: 52_000 }, MARKET, 65_000)).toEqual([
      "targetBelowMarket",
    ]);
    expect(mandateHints({ salaryFloor: 70_000, salaryTarget: 80_000 }, MARKET, 65_000)).toEqual([
      "targetAboveMarket",
      "floorAboveOffer",
    ]);
    // Sans repère (pas assez de données) ni salaire annoncé : aucun conseil chiffré.
    expect(mandateHints({ salaryFloor: 70_000, salaryTarget: 80_000 }, null, null)).toEqual([]);
  });

  it("chiffres du repère acceptés dans un brouillon ; tout autre chiffre toujours rejeté", () => {
    const allowed = allowedWith(withMarket());
    expect(allowed.market).toEqual([56_000, 61_000, 67_000]);
    const ok =
      "Les offres publiées pour des postes similaires dans cette zone affichent une médiane de 61 000 €. Elle souhaite 62 000 €.";
    expect(checkOutgoing(ok, MANDATE, { allowed })).toEqual([]);
    expect(
      checkOutgoing("Published offers for similar roles show a p75 of €67,000.", MANDATE, {
        allowed,
      }),
    ).toEqual([]);
    expect(
      checkOutgoing("Les offres publiées affichent une médiane de 63 500 €.", MANDATE, {
        allowed,
      }),
    ).toMatchObject([{ code: "inventedFigure", excerpt: "63 500 €" }]);
    // Sans repère, ses chiffres ne sont pas autorisés.
    const without = allowedFigures(MANDATE, facts().companyMessages, [55_000, 65_000]);
    expect(checkOutgoing(ok, MANDATE, { allowed: without })).toMatchObject([
      { code: "inventedFigure", excerpt: "61 000 €" },
    ]);
  });

  it("anti-bluff : le repère présenté comme une offre reçue est rejeté", () => {
    const allowed = allowedWith(withMarket());
    for (const bluff of [
      "Une autre entreprise lui a proposé 67 000 €.",
      "Elle a reçu une offre à 67 000 € brut annuel.",
      "Another company offered the candidate €67,000.",
      "The candidate received an offer of €61,000 elsewhere.",
      "Ein anderes Unternehmen bietet ihr 67.000 €.",
      // Chiffre du repère sans dire qu'il vient d'offres publiées.
      "Le marché est à 61 000 €, elle souhaite donc 62 000 €.",
      // « Offres publiées » ne blanchit pas une offre faite à la candidate (QA #41).
      "A competitor offered her €67,000, in line with published offers.",
      "Elle a déjà une proposition à 67 000 €, comme le confirment les offres publiées.",
      "Un recruteur lui a proposé 67 000 €, en ligne avec les offres publiées.",
      "She has been offered €67,000 elsewhere, which matches published offers.",
      "Ihr wurde bereits 67.000 € angeboten, wie veröffentlichte Angebote zeigen.",
      "Le han ofrecido 67.000 €, en línea con las ofertas publicadas.",
      "Un concorrente le ha proposto 67.000 €, in linea con le offerte pubblicate.",
      "Haar werd al € 67.000 aangeboden, zoals gepubliceerde vacatures tonen.",
      // Même avec la forme statistique, aucun verbe d'offre ni tiers.
      "Un recruteur cite la médiane des offres publiées : 61 000 €.",
      "Published offers show a median of €61,000, and she was offered that elsewhere.",
      // Chiffre isolé, sans statistique : pas la forme du repère.
      "Les offres publiées vont jusqu'à 67 000 €.",
    ]) {
      expect(
        checkOutgoing(bluff, MANDATE, { allowed }).map((i) => i.code),
        bluff,
      ).toContain("competingOffer");
    }
    // Même avec une offre concurrente déclarée au mandat, le repère n'en devient pas une.
    const declared = { ...MANDATE, facts: "J’ai une autre offre en cours." };
    const mixed = "Elle a une autre offre à 67 000 €, comme le montrent les offres publiées.";
    expect(checkOutgoing(mixed, declared, { allowed }).map((i) => i.code)).toEqual([
      "competingOffer",
    ]);
  });

  it("le modèle cite la médiane comme offres publiées, dans les six langues, sans bluff", () => {
    for (const locale of routing.locales as readonly AppLocale[]) {
      const f = withMarket({ locale });
      const counter = ruleCounterBody(f);
      expect(salaryAmounts(counter), locale).toEqual([62_000, 61_000]);
      expect(checkOutgoing(counter, MANDATE, { allowed: allowedWith(f) }), counter).toEqual([]);
      expect(checkOutgoing(counter, MANDATE), locale).toEqual([]);
    }
    // Médiane sous le plancher : jamais citée.
    const low = withMarket({ market: { ...MARKET, p25: 40_000, median: 45_000, p75: 50_000 } });
    expect(salaryAmounts(ruleCounterBody(low))).toEqual([62_000]);
  });

  it("brouillon IA : repère transmis et citable ; bluff à partir du repère → modèle", async () => {
    const body =
      "Bonjour,\n\nMerci pour votre proposition de 58 000 €. Les offres publiées pour des postes similaires dans cette zone affichent une médiane de 61 000 € ; la personne candidate souhaite 62 000 € brut annuel, en CDI, avec 2 jours de télétravail par semaine.\n\nBien cordialement,";
    const ai = aiReplying(body);
    expect(await buildNegotiationDraft("counter", withMarket(), ai.client, CONTEXT)).toEqual({
      body,
      source: "llm",
    });
    const prompt = JSON.stringify(ai.provider.calls[0]!.messages);
    expect(prompt).toContain("marketBenchmarkFromPublishedOffers");
    expect(prompt).toContain("61000");
    expect(prompt).not.toContain("Testard");

    const bluff =
      "Bonjour,\n\nUne autre entreprise lui a proposé 67 000 € ; elle souhaite donc 62 000 € brut annuel, en CDI.\n\nBien cordialement,";
    const draft = await buildNegotiationDraft(
      "counter",
      withMarket(),
      aiReplying(bluff).client,
      CONTEXT,
    );
    expect(draft).toMatchObject({ source: "rules", fallback: "check" });
    expect(draft.body).toBe(ruleCounterBody(withMarket()));

    // « Offres publiées » accolé à une offre reçue : toujours le modèle.
    for (const sentence of [
      "Un recruteur lui a proposé 67 000 €, en ligne avec les offres publiées.",
      "Elle a déjà une proposition à 67 000 €, comme le confirment les offres publiées.",
    ]) {
      const laundered = `Bonjour,\n\n${sentence} Elle souhaite donc 62 000 € brut annuel, en CDI.\n\nBien cordialement,`;
      const d = await buildNegotiationDraft(
        "counter",
        withMarket(),
        aiReplying(laundered).client,
        CONTEXT,
      );
      expect(d, sentence).toMatchObject({ source: "rules", fallback: "check" });
      expect(d.body).toBe(ruleCounterBody(withMarket()));
    }
  });

  it("repère sous le seuil : non transmis au modèle, ses chiffres refusés", async () => {
    const market = marketForNegotiation({ ...MARKET, sampleSize: 3 }, 10);
    const f = facts({ market });
    const cites =
      "Bonjour,\n\nLes offres publiées pour des postes similaires affichent une médiane de 61 000 € ; la personne candidate souhaite 62 000 € brut annuel, en CDI.\n\nBien cordialement,";
    const ai = aiReplying(cites);
    const draft = await buildNegotiationDraft("counter", f, ai.client, CONTEXT);
    const prompt = String(ai.provider.calls[0]!.messages[1]!.content);
    expect(prompt).toContain("salaryFloorNeverGoBelowAndNeverMention");
    expect(prompt).not.toContain("marketBenchmarkFromPublishedOffers");
    expect(prompt).not.toContain("61000");
    expect(draft).toMatchObject({ source: "rules", fallback: "check" });
    expect(salaryAmounts(draft.body)).toEqual([62_000]);
  });
});
