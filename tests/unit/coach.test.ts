import { describe, expect, it } from "vitest";
import { createAiClient, createMockProvider, scriptedReplies } from "@/lib/ai";
import { createLogger } from "@/lib/logger";
import { coachSystemPrompt, MODE_TOOLS } from "@/lib/coach/prompts";
import { coachMessagesPerDay, remainingMessages } from "@/lib/coach/quota";
import { emailNameParts, redactPlain, redactSuggestion } from "@/lib/coach/redact";
import { guardRailSuggestion, SUGGESTION_SCHEMAS } from "@/lib/coach/shared";
import { chunkText, coachErrorCode } from "@/lib/coach/turn";
import { AiError } from "@/lib/ai/errors";
import { z } from "zod";

describe("coach : pseudonymisation des suggestions", () => {
  it("extrait les parties de nom d'une adresse e-mail", () => {
    expect(emailNameParts("jeanne.testard-42@exemple.fr")).toEqual(["jeanne", "testard"]);
    expect(emailNameParts("jo@x.fr")).toEqual([]);
  });

  it("retire contacts, termes connus et termes signalés, et le signale", () => {
    const { data, changed } = redactSuggestion(
      "ACHIEVEMENT",
      {
        title: "Refonte du paiement chez Qonto",
        context: "Écrire à jeanne@exemple.fr ou au 06 12 34 56 78",
        actions: "Avec Paul Durand, j'ai migré l'API",
        result: "+12 % de conversion",
        skills: ["Go", "Qonto"],
        proofUrl: "https://github.com/jeanne",
      },
      { knownTerms: ["jeanne"], declaredTerms: ["Qonto", "Paul Durand"] },
    );
    expect(changed).toBe(true);
    const text = JSON.stringify(data);
    for (const term of ["Qonto", "jeanne", "06 12", "Paul Durand"])
      expect(text).not.toContain(term);
    expect(data.result).toBe("+12 % de conversion");
    expect(data.skills).toEqual(["Go"]);
    // Profil personnel : jamais une preuve.
    expect(data.proofUrl).toBeUndefined();
  });

  it("garde un lien de preuve public et un texte neutre intacts", () => {
    const input = {
      title: "Bibliothèque open source",
      context: "",
      actions: "Publication d'un client HTTP",
      result: "2 000 téléchargements par mois",
      skills: ["TypeScript"],
      proofUrl: "https://github.com/acme-oss/http-client",
    };
    expect(redactSuggestion("ACHIEVEMENT", input, { knownTerms: [] })).toEqual({
      data: input,
      changed: false,
    });
  });

  it("pseudonymise aussi la justification et les zones de garde-fous", () => {
    expect(redactPlain("Annoncé par Jeanne", { knownTerms: ["jeanne"] })).toBe("Annoncé par […]");
    const { data } = redactSuggestion(
      "GUARD_RAIL",
      { minFixedSalary: 50000, locations: [{ label: "Lyon", radiusKm: 20 }] },
      { knownTerms: [] },
    );
    expect(data).toEqual({ minFixedSalary: 50000, locations: [{ label: "Lyon", radiusKm: 20 }] });
  });
});

describe("coach : schémas des suggestions", () => {
  it("refuse une suggestion vide", () => {
    expect(guardRailSuggestion.safeParse({}).success).toBe(false);
    expect(
      SUGGESTION_SCHEMAS.EXPERIENCE_UPDATE.safeParse({ experienceId: "x", changes: {} }).success,
    ).toBe(false);
  });

  it("n'accepte que des valeurs connues", () => {
    expect(guardRailSuggestion.safeParse({ remotePolicy: "UNKNOWN" }).success).toBe(false);
    expect(guardRailSuggestion.safeParse({ minFixedSalary: -1 }).success).toBe(false);
    expect(SUGGESTION_SCHEMAS.SKILL.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });
});

describe("coach : quota", () => {
  it("lit la limite quotidienne depuis l'environnement", () => {
    expect(coachMessagesPerDay({})).toBe(40);
    expect(coachMessagesPerDay({ COACH_MESSAGES_PER_DAY: "5" })).toBe(5);
    expect(coachMessagesPerDay({ COACH_MESSAGES_PER_DAY: "0" })).toBe(0);
    expect(coachMessagesPerDay({ COACH_MESSAGES_PER_DAY: "abc" })).toBe(40);
    expect(remainingMessages(3, 5)).toBe(2);
    expect(remainingMessages(9, 5)).toBe(0);
  });
});

describe("coach : consignes et outils", () => {
  it("se présente comme une IA, refuse d'inventer et ne demande pas d'identité", () => {
    const prompt = coachSystemPrompt("DISCOVER", "de");
    expect(prompt).toContain("You are an AI assistant");
    expect(prompt).toContain("Never invent experience");
    expect(prompt).toContain("Never ask for the candidate's name");
    expect(prompt).toContain("Always answer in German");
  });

  it("n'autorise que les outils de la compétence choisie", () => {
    expect(MODE_TOOLS.INTERVIEW).toEqual(["read_career_memory"]);
    expect(MODE_TOOLS.CLARIFY).not.toContain("propose_achievement");
    expect(MODE_TOOLS.DISCOVER).not.toContain("propose_guard_rail_change");
  });

  it("découpe la réponse sans rien perdre", () => {
    const text = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(" ");
    const chunks = chunkText(text, 24);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toBe(text);
    expect(chunkText("")).toEqual([]);
  });

  it("traduit les erreurs du fournisseur en codes affichables", () => {
    expect(coachErrorCode(new AiError("timeout"))).toBe("aiTimeout");
    expect(coachErrorCode(new AiError("badRequest"))).toBe("aiUnavailable");
    expect(coachErrorCode(new Error("x"))).toBe("unknown");
  });

  it("signale chaque étape de la boucle d'outils", async () => {
    const client = createAiClient({
      provider: createMockProvider({
        respond: scriptedReplies(
          { toolCalls: [{ id: "1", name: "echo", arguments: "{}" }] },
          "fini",
        ),
      }),
      logger: createLogger({ write: () => {} }),
    });
    const steps: number[] = [];
    const result = await client.runTools({
      purpose: "test",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          definition: { name: "echo", description: "", parameters: {} },
          args: z.object({}),
          execute: () => "ok",
        },
      ],
      onStep: (step) => steps.push(step),
    });
    expect(result.content).toBe("fini");
    expect(steps).toEqual([1, 2]);
  });
});

describe("coach : codes partagés", () => {
  it("correspondent aux enums Prisma", async () => {
    const enums = await import("@/generated/prisma/enums");
    const shared = await import("@/lib/coach/shared");
    expect(Object.values(enums.CoachMode).sort()).toEqual([...shared.COACH_MODES].sort());
    expect(Object.values(enums.CoachSuggestionKind).sort()).toEqual(
      [...shared.SUGGESTION_KINDS].sort(),
    );
    expect(Object.values(enums.CoachSuggestionStatus).sort()).toEqual(
      [...shared.SUGGESTION_STATUSES].sort(),
    );
  });
});
