import { describe, expect, it } from "vitest";
import { AiError, createAiClient, createMockProvider, scriptedReplies } from "@/lib/ai";
import { LOCALES } from "@/i18n/routing";
import {
  buildExplanation,
  displaySummary,
  explanationFacts,
  explanationSchema,
  factLines,
  ruleSummary,
} from "@/lib/matching/explanation";
import { evaluateOffer } from "@/lib/matching/score";
import { CASES, OFFERS } from "../fixtures/matching/cases";

const [dataCase] = CASES;
const offer = OFFERS.find((o) => o.id === "de-no-salary")!;
const evaluation = evaluateOffer(dataCase!.profile, dataCase!.rails, offer, null);
if (!evaluation.pass) throw new Error("offre attendue retenue");
const facts = explanationFacts(evaluation);
const input = { offerTitle: offer.title, score: evaluation.score, facts, locale: "fr" as const };

const noSleep = async () => {};
const client = (respond: Parameters<typeof createMockProvider>[0]) =>
  createAiClient({ provider: createMockProvider(respond), sleep: noSleep, backoffMs: 0 });

describe("explication", () => {
  it("le LLM formule le résumé à partir des faits (sortie JSON validée)", async () => {
    const provider = createMockProvider({
      respond: scriptedReplies(
        JSON.stringify({ summary: "Votre expérience Python correspond bien à ce poste." }),
      ),
    });
    const explanation = await buildExplanation(input, createAiClient({ provider }));
    expect(explanation).toMatchObject({
      source: "llm",
      locale: "fr",
      summary: expect.stringContaining("Python"),
    });
    expect(explanationSchema.safeParse(explanation).success).toBe(true);
    // Le modèle ne reçoit que des faits sur l'offre et les correspondances.
    const prompt = provider.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("Data Engineer");
    expect(prompt).toContain("French");
    expect(provider.calls[0]!.purpose).toBe("matching.explain");
  });

  it("LLM indisponible : résumé déterministe, jamais vide", async () => {
    const errors: string[] = [];
    const explanation = await buildExplanation(
      input,
      client({ respond: scriptedReplies({ error: new AiError("unavailable") }) }),
      { onError: (code) => errors.push(code) },
    );
    expect(explanation.source).toBe("rules");
    expect(explanation.summary).toBe(ruleSummary(evaluation.score, facts, "fr"));
    expect(explanation.summary).toContain("Le salaire n’est pas indiqué.");
    expect(errors).toEqual(["unavailable"]);
  });

  it("LLM trop lent : délai dépassé, résumé déterministe (pas d'attente infinie)", async () => {
    const started = Date.now();
    const explanation = await buildExplanation(
      input,
      client({ respond: scriptedReplies({ content: "{}", delayMs: 5_000 }) }),
      { timeoutMs: 50 },
    );
    expect(explanation.source).toBe("rules");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("réponse non conforme au schéma : résumé déterministe", async () => {
    const explanation = await buildExplanation(
      input,
      client({ respond: scriptedReplies(JSON.stringify({ summary: "court" })) }),
    );
    expect(explanation.source).toBe("rules");
  });

  it("sans client IA : résumé déterministe sans aucun appel", async () => {
    const explanation = await buildExplanation(input, null);
    expect(explanation.source).toBe("rules");
    expect(explanation.unknowns).toContain("salaryNotStated");
  });

  it("faits et résumé disponibles dans les 6 langues", () => {
    for (const locale of LOCALES) {
      const summary = ruleSummary(evaluation.score, facts, locale);
      expect(summary.length, locale).toBeGreaterThan(20);
      const lines = factLines(facts, locale);
      expect(lines.unknowns.length).toBe(facts.unknowns.length);
      expect(
        [...lines.matches, ...lines.gaps, ...lines.unknowns].every((l) => l.trim().length > 0),
      ).toBe(true);
    }
    expect(factLines(facts, "fr").matches[0]).toMatch(
      /^Votre réalisation « .+ » répond à l’exigence « .+ »\.$/,
    );
  });

  it("affiche le résumé stocké dans sa langue, sinon le résumé déterministe", async () => {
    const explanation = {
      ...(await buildExplanation(input, null)),
      source: "llm" as const,
      summary: "Résumé du modèle.",
    };
    expect(displaySummary(explanation, 70, "fr")).toBe("Résumé du modèle.");
    expect(displaySummary(explanation, 70, "en")).toBe(ruleSummary(70, explanation, "en"));
    expect(displaySummary(null, 70, "de")).toContain("70/100");
  });
});
