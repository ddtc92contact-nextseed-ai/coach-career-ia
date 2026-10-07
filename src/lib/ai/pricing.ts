/**
 * Prix publics indicatifs (USD par million de jetons, entrée / sortie), pour
 * suivre l'ordre de grandeur du coût dans les journaux. Les modèles locaux
 * (Ollama) sont gratuits ; un modèle inconnu n'a pas d'estimation.
 */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "mistral-small-latest": { input: 0.1, output: 0.3 },
  "mistral-medium-latest": { input: 0.4, output: 2 },
  "mistral-large-latest": { input: 2, output: 6 },
  "ministral-8b-latest": { input: 0.1, output: 0.1 },
  "open-mistral-nemo": { input: 0.15, output: 0.15 },
  "mistral-embed": { input: 0.1, output: 0 },
};

export function estimateCostUsd(
  provider: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number | undefined {
  if (provider === "mock" || provider === "openai-compatible") return 0;
  const price = PRICES_PER_MTOK[model];
  if (!price) return undefined;
  const cost = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}
