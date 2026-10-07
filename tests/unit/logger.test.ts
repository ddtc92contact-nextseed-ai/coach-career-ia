import { describe, expect, it } from "vitest";
import { createLogger, sanitizeContext, scrubString } from "@/lib/logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: "debug",
    write: (_level, line) => lines.push(JSON.parse(line)),
  });
  return { logger, lines };
}

describe("lib/logger", () => {
  it("écrit une ligne JSON avec l'événement et le contexte", () => {
    const { logger, lines } = capture();
    logger.info("opportunity.matched", { userId: "u_1", score: 0.82 });
    expect(lines[0]).toMatchObject({
      level: "info",
      event: "opportunity.matched",
      userId: "u_1",
      score: 0.82,
    });
  });

  it("masque les clés sensibles", () => {
    const safe = sanitizeContext({
      email: "jane@exemple.fr",
      firstName: "Jane",
      phone: "0612345678",
      password: "x",
      token: "abc",
      employer: "Société Exemple",
      requestBody: "...",
    });
    for (const value of Object.values(safe)) expect(value).toBe("[masqué]");
  });

  it("ne sérialise jamais d'objet ni de tableau (corps de requête, entités)", () => {
    const safe = sanitizeContext({
      data: { email: "jane@exemple.fr", nested: { secret: 1 } },
      list: ["jane@exemple.fr"],
    });
    expect(safe).toEqual({ data: "[objet omis]", list: "[objet omis]" });
  });

  it("masque e-mails, téléphones, jetons et paramètres d'URL dans les chaînes", () => {
    const text = scrubString(
      "contact jane.doe+cv@exemple.fr / +33 6 12 34 56 78 / 06.12.34.56.78 Bearer eyJabc.def https://app.test/api/auth/callback/email?token=t&email=x",
    );
    expect(text).not.toMatch(/jane|12 34|12\.34|eyJ|token=|email=x/);
    expect(text).toContain("https://app.test/api/auth/callback/email?[masqué]");
  });

  it("ne garde d'une erreur que nom, message filtré et code", () => {
    const error = Object.assign(new Error("Unique constraint failed for jane@exemple.fr"), {
      code: "P2002",
    });
    const safe = sanitizeContext({ error });
    expect(safe.error).toEqual({
      name: "Error",
      message: "Unique constraint failed for [masqué]",
      code: "P2002",
    });
  });

  it("respecte le niveau minimal", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", write: (_l, line) => lines.push(line) });
    logger.info("ignored");
    logger.error("kept");
    expect(lines).toHaveLength(1);
  });
});
