import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/routing";
import { AiError, createAiClient, createMockProvider } from "@/lib/ai";
import { cardSchema } from "@/lib/card/schema";
import { contactDailyLimit, remainingContacts } from "@/lib/contact/config";
import { buildDraft, draftPromptFacts, ruleDraftBody, type DraftFacts } from "@/lib/contact/draft";
import { contactEmail, pasteText, replyNotificationEmail } from "@/lib/contact/email";
import { detectLanguage, offerLanguage } from "@/lib/contact/language";

const card = cardSchema.parse({
  version: 1,
  headline: "Data engineer senior",
  seniority: "SENIOR",
  yearsOfExperience: 8,
  achievements: [
    {
      title: "Pipeline temps réel",
      result: "Latence divisée par 10",
      evidenceLevel: "DOCUMENT",
      skills: ["Kafka"],
      proofUrls: [],
    },
  ],
  skills: [{ name: "Kafka", proven: true }],
  rails: {
    salaryFloor: 60000,
    remotePolicy: "HYBRID",
    minRemoteDays: null,
    contractTypes: ["CDI"],
    locations: [],
  },
  showSalary: true,
  showLocations: false,
  allowProofUrls: false,
});

const facts = (locale: DraftFacts["locale"] = "fr"): DraftFacts => ({
  locale,
  offerTitle: "Data engineer",
  companyName: "Initrode",
  score: 80,
  card,
  matchedSkills: [{ name: "Kafka", proven: true }],
});

const client = (respond: () => string | { error: AiError }) =>
  createAiClient({
    provider: createMockProvider({ respond }),
    sleep: async () => {},
    backoffMs: 0,
  });

const LINKS = {
  cardUrl: "https://coach.test/fr/p/TOKEN",
  replyUrl: "https://coach.test/fr/p/TOKEN/repondre",
  expiresAt: new Date("2026-11-06T12:00:00Z"),
};

describe("langue de l'offre", () => {
  it("détecte les six langues et se replie selon la source ou le pays", () => {
    expect(
      detectLanguage("Nous recherchons une personne pour notre équipe, le poste est en CDI."),
    ).toBe("fr");
    expect(detectLanguage("You will join our team and this role is with the data platform.")).toBe(
      "en",
    );
    expect(
      detectLanguage("Buscamos una persona para nuestro equipo, el puesto es con contrato."),
    ).toBe("es");
    expect(detectLanguage("Cerchiamo una persona per il nostro ruolo, che sarà nella sede.")).toBe(
      "it",
    );
    expect(
      detectLanguage("Wir suchen für unser Team eine Person, die mit der Stelle wächst."),
    ).toBe("de");
    expect(
      detectLanguage("Wij zoeken voor onze functie een collega met ervaring bij het team."),
    ).toBe("nl");
    expect(detectLanguage("Data engineer")).toBeNull();
    const short = { title: "Data engineer", description: "Kafka, Spark" };
    expect(offerLanguage({ ...short, source: "france_travail", country: "FR" })).toBe("fr");
    expect(offerLanguage({ ...short, source: "lever", country: "DE" })).toBe("en");
  });
});

describe("quota de prises de contact", () => {
  it("lit CONTACT_DAILY_LIMIT (5 par défaut)", () => {
    expect(contactDailyLimit({})).toBe(5);
    expect(contactDailyLimit({ CONTACT_DAILY_LIMIT: "2" })).toBe(2);
    expect(contactDailyLimit({ CONTACT_DAILY_LIMIT: "0" })).toBe(0);
    expect(contactDailyLimit({ CONTACT_DAILY_LIMIT: "-1" })).toBe(5);
    expect(contactDailyLimit({ CONTACT_DAILY_LIMIT: "abc" })).toBe(5);
    expect(remainingContacts(3, 5)).toBe(2);
    expect(remainingContacts(7, 5)).toBe(0);
  });
});

describe("brouillon du message", () => {
  it("modèle déterministe dans chaque langue, sans identité", () => {
    for (const locale of LOCALES) {
      const body = ruleDraftBody(facts(locale));
      expect(body, locale).toContain("Pipeline temps réel — Latence divisée par 10");
      expect(body, locale).toContain("Kafka");
      expect(body).not.toMatch(/@|https?:/);
    }
    expect(ruleDraftBody(facts("fr"))).toContain("Je suis l’agent de carrière IA");
  });

  it("ne confie au modèle que la carte publique et la correspondance", () => {
    const prompt = JSON.stringify(draftPromptFacts(facts()));
    expect(prompt).toContain("Pipeline temps réel");
    expect(prompt).not.toMatch(/salaryFloor|60000/);
  });

  it("se replie sur le modèle si l'IA échoue ou produit un texte ré-identifiant", async () => {
    const codes: string[] = [];
    const onError = (code: string) => codes.push(code);
    const ok = await buildDraft(
      facts(),
      client(() =>
        JSON.stringify({
          body: "Bonjour,\n\nJe suis l’agent IA d’une personne candidate dont l’expérience des pipelines temps réel répond à vos besoins.\n\nCordialement,",
        }),
      ),
      [],
    );
    expect(ok.source).toBe("llm");
    expect(ok.subject).toBe("Candidature anonyme – Data engineer");

    const leaky = await buildDraft(
      facts(),
      client(() =>
        JSON.stringify({
          body: "Bonjour, je représente une candidate passée chez Globex depuis mars 2021, joignable au 06 12 34 56 78, qui serait ravie de vous rencontrer.",
        }),
      ),
      ["Globex"],
      { onError },
    );
    expect(leaky.source).toBe("rules");
    expect(leaky.body).not.toMatch(/Globex|2021|06 12/);

    const down = await buildDraft(
      facts("de"),
      client(() => ({ error: new AiError("unavailable") })),
      [],
      {
        onError,
      },
    );
    expect(down).toMatchObject({ source: "rules", subject: "Anonyme Bewerbung – Data engineer" });
    expect(codes).toEqual(["reidentifying", "unavailable"]);
    expect(await buildDraft(facts(), null, [])).toMatchObject({ source: "rules" });
  });
});

describe("e-mail envoyé à l'entreprise", () => {
  it("ajoute la mention IA (AI Act art. 50) et les liens, dans la langue de l'offre", () => {
    const disclosures = {
      fr: "préparé par un agent IA",
      en: "prepared by an AI agent",
      es: "preparado un agente de IA",
      it: "preparato da un agente IA",
      de: "von einem KI-Agenten",
      nl: "opgesteld door een AI-agent",
    } as const;
    for (const locale of LOCALES) {
      const mail = contactEmail(locale, { subject: "Objet", body: "Bonjour,\n\nTexte." }, LINKS);
      expect(mail.text, locale).toContain(LINKS.cardUrl);
      expect(mail.text, locale).toContain(LINKS.replyUrl);
      expect(mail.html, locale).toContain(`lang="${locale}"`);
      expect(mail.headers?.["X-AI-Generated"]).toBe("ai-drafted; human-approved");
      const words = disclosures[locale].split(" ");
      for (const word of words) expect(mail.text, locale).toContain(word);
    }
    const html = contactEmail("fr", { subject: "S", body: "<script>x</script>" }, LINKS).html;
    expect(html).not.toContain("<script>");
    expect(pasteText("en", "Hello", LINKS)).toContain("prepared by an AI agent");
  });

  it("prévient le candidat d'une réponse sans en reprendre le contenu", () => {
    const mail = replyNotificationEmail("fr", {
      offerTitle: "Data engineer",
      inboxUrl: "https://coach.test/fr/app/contacts/c1",
    });
    expect(mail.text).toContain("https://coach.test/fr/app/contacts/c1");
    expect(mail.subject).toBe("Une entreprise a répondu à votre prise de contact");
  });
});
