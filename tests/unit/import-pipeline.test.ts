import { describe, expect, it } from "vitest";
import { AiError, createAiClient, createMockProvider, scriptedReplies } from "@/lib/ai";
import { runImport } from "@/lib/import/pipeline";
import type { ImportResult } from "@/lib/import/shared";
import { createLogger } from "@/lib/logger";
import { IMPORT_CASES } from "../fixtures/import/cases";

const silent = createLogger({ write: () => {} });

function clientFor(...replies: Parameters<typeof scriptedReplies>) {
  const provider = createMockProvider({ respond: scriptedReplies(...replies) });
  return {
    provider,
    ai: createAiClient({ provider, logger: silent, sleep: async () => {}, maxRetries: 1 }),
  };
}

/** Tous les textes libres du brouillon (hors URL de preuves). */
function draftTexts(result: ImportResult): string[] {
  const { draft, flags } = result;
  return [
    ...draft.experiences.flatMap((e) => [e.roleTitle, e.responsibilities]),
    ...draft.achievements.flatMap((a) => [a.title, a.context, a.actions, a.result, ...a.skills]),
    ...draft.skills,
    ...flags.experiences.flatMap((f) => f.rareDetails),
    ...flags.achievements.flatMap((f) => f.rareDetails),
  ];
}

describe.each(IMPORT_CASES)("Import IA, fixture $id", (fixture) => {
  async function run() {
    const { ai, provider } = clientFor(fixture.llmReply());
    const result = await runImport(fixture.sources(), {
      ai,
      locale: fixture.locale,
      githubFetch: fixture.githubFetch,
    });
    return { result, provider };
  }

  it("produit le brouillon attendu", async () => {
    const { result } = await run();
    expect(result).toEqual(fixture.expected());
  });

  it("le brouillon serveur ne contient ni nom, ni contact, ni employeur, ni école", async () => {
    const { result } = await run();
    const serialized = JSON.stringify(result.draft).toLowerCase();
    for (const value of fixture.forbidden) {
      expect(serialized, value).not.toContain(value.toLowerCase());
    }
    const texts = draftTexts(result).join("\n").toLowerCase();
    for (const value of fixture.forbiddenInText) {
      expect(texts, value).not.toContain(value.toLowerCase());
    }
    // Les données identifiantes sont dans la charge « identité », destinée au seul navigateur.
    expect(result.identity.fullName).toBe(fixture.forbidden[0]);
  });

  it("n'envoie au modèle ni e-mail, ni téléphone, ni lien de profil", async () => {
    const { provider } = await run();
    const prompt = provider.calls[0]!.messages.map((m) => m.content).join("\n");
    for (const value of fixture.notSentToModel) {
      expect(prompt, value).not.toContain(value);
    }
  });
});

describe("Import IA : langue, preuves, signalements", () => {
  it("demande au modèle d'écrire dans la langue de l'utilisateur", async () => {
    const [en, de] = [IMPORT_CASES[1]!, IMPORT_CASES[2]!];
    const { ai, provider } = clientFor(en.llmReply(), de.llmReply());
    await runImport(en.sources(), { ai, locale: "fr" });
    await runImport(de.sources(), { ai, locale: "de" });
    expect(provider.calls[0]!.messages[0]!.content).toContain("in French");
    expect(provider.calls[1]!.messages[0]!.content).toContain("in German");
  });

  it("joint les dépôts GitHub comme preuves et les signale comme identifiants", async () => {
    const fixture = IMPORT_CASES[3]!;
    const result = fixture.expected();
    const library = result.draft.achievements.find((a) => a.proofs.length > 0)!;
    expect(library.proofs).toEqual([
      { kind: "URL", url: "https://github.com/hverdier-dev/jours-feries" },
    ]);
    const index = result.draft.achievements.indexOf(library);
    expect(result.flags.achievements[index]!.identifyingLink).toBe(true);
    // Le profil GitHub lui-même n'est jamais une preuve : il va dans l'identité.
    expect(result.identity.links).toContain("https://github.com/hverdier-dev");
    expect(JSON.stringify(result.draft)).not.toContain('"https://github.com/hverdier-dev"');
  });

  it("fusionne les compétences LinkedIn et les langages GitHub", async () => {
    const result = IMPORT_CASES[3]!.expected();
    expect(result.draft.skills).toEqual(expect.arrayContaining(["Scrum", "Jira", "SQL"]));
    // Déjà portées par une réalisation : pas de doublon dans les compétences déclarées.
    expect(result.draft.skills).not.toContain("Python");
    expect(result.draft.skills).not.toContain("Product Management");
  });

  it("répare une réponse invalide, une seule fois", async () => {
    const fixture = IMPORT_CASES[0]!;
    const { ai, provider } = clientFor('{"experiences": "pas une liste"}', fixture.llmReply());
    const result = await runImport(fixture.sources(), { ai, locale: "fr" });
    expect(provider.calls).toHaveLength(2);
    expect(result).toEqual(fixture.expected());
  });

  it("propage un dépassement de délai du fournisseur sous forme de code", async () => {
    const fixture = IMPORT_CASES[0]!;
    const { ai } = clientFor({ error: new AiError("timeout") });
    await expect(runImport(fixture.sources(), { ai, locale: "fr" })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("refuse un import sans source", async () => {
    const { ai, provider } = clientFor("{}");
    await expect(runImport({ github: "  " }, { ai, locale: "fr" })).rejects.toMatchObject({
      code: "noSource",
    });
    expect(provider.calls).toHaveLength(0);
  });
});
