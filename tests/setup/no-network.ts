/**
 * Aucun test n'accède au réseau (fournisseur IA, GitHub…) : `fetch` global
 * échoue. Les modules qui font des requêtes reçoivent un `fetch` simulé.
 */
globalThis.fetch = (async (input: unknown) => {
  const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
  throw new Error(`Accès réseau interdit pendant les tests : ${url}`);
}) as typeof fetch;
