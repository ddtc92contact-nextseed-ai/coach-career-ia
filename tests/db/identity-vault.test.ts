import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Base de test et session simulée : client du coffre et routes exécutés tels quels.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

const { db } = await import("@/lib/db");
const { getCurrentUser } = await import("@/lib/auth/session");
const vaultRoute = await import("@/app/api/vault/route");
const cvRoute = await import("@/app/api/vault/cv/route");
const { GET: exportRoute } = await import("@/app/api/account/export/route");
const { createVaultClient, VaultHttpError } = await import("@/lib/vault/client");
const { identityData } = await import("@/lib/vault/identity");

const url = process.env.TEST_DATABASE_URL;

const PASSPHRASE = "ma phrase secrète du coffre";
const NEW_PASSPHRASE = "une toute nouvelle phrase";
const identity = identityData.parse({
  firstName: "Héloïse",
  lastName: "Vasquez-Moreau",
  email: "heloise.vasquez@exemple.fr",
  phone: "+33 6 98 76 54 32",
  employers: [{ experienceId: "exp_test", name: "Initech Industries" }],
  schools: [{ name: "Université Paris-Saclay" }],
  links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/heloise-vasquez-moreau" }],
});
const CV_NAME = "CV Héloïse Vasquez-Moreau.pdf";
const CV_TEXT = "%PDF-1.7 Curriculum vitae confidentiel Vasquez-Moreau";

/** Toutes les chaînes qui ne doivent JAMAIS atteindre le serveur. */
const SECRETS = [
  PASSPHRASE,
  NEW_PASSPHRASE,
  "Héloïse",
  "Heloise",
  "Vasquez",
  "heloise.vasquez@exemple.fr",
  "98 76 54 32",
  "Initech",
  "Paris-Saclay",
  "linkedin.com/in/heloise",
  "Curriculum vitae",
  "application/pdf",
];

type Captured = { method: string; path: string; body: Buffer };
const requests: Captured[] = [];
const logLines: string[] = [];

type Handler = (request: Request) => Promise<Response>;
const routes: Record<string, Record<string, Handler>> = {
  "/api/vault": vaultRoute as unknown as Record<string, Handler>,
  "/api/vault/cv": cvRoute as unknown as Record<string, Handler>,
};

/** `fetch` du navigateur, branché directement sur les routes, qui capture chaque requête. */
async function routedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const request = new Request(`http://test${input}`, {
    method,
    headers: init.headers,
    body: init.body,
  });
  const body = Buffer.from(await request.clone().arrayBuffer());
  requests.push({ method, path: input, body });
  const handler = routes[input]?.[method];
  if (!handler) return new Response(null, { status: 405 });
  return handler(request);
}

/** Le contenu, en clair et décodé du base64 quand c'en est. */
function readable(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  const decoded = [...text.matchAll(/[A-Za-z0-9+/=]{16,}/g)].map((m) =>
    Buffer.from(m[0], "base64").toString("utf8"),
  );
  return [text, bytes.toString("latin1"), ...decoded].join("\n");
}

function expectNoSecret(haystack: string, secrets: readonly string[] = SECRETS) {
  for (const secret of secrets) expect(haystack).not.toContain(secret);
}

async function newUser(label: string) {
  return db.user.create({
    data: { email: `${label}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test` },
  });
}

function asUser(user: { id: string; email: string } | null) {
  vi.mocked(getCurrentUser).mockResolvedValue(user);
}

describe.skipIf(!url)("coffre d'identité : le serveur ne reçoit que des chiffrés", () => {
  const client = createVaultClient(routedFetch);
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };
  let recoveryKey: string;

  beforeAll(async () => {
    // Journaux du serveur pendant le test : tout ce qui passe par la console.
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map(String).join(" "));
      });
    }
    alice = await newUser("alice-vault");
    bob = await newUser("bob-vault");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.user.deleteMany({ where: { id: { in: [alice?.id, bob?.id].filter(Boolean) } } });
    await db.$disconnect();
  });

  it("parcours complet : création, saisie, CV, changement de phrase, récupération", async () => {
    asUser(alice);
    expect(await client.fetch()).toBeNull();

    const created = await client.setup(PASSPHRASE);
    recoveryKey = created.recoveryKey;
    const saved = await client.saveIdentity(created.vault, identity);
    expect(
      (
        await client.uploadCv(saved, {
          name: CV_NAME,
          type: "application/pdf",
          bytes: new TextEncoder().encode(CV_TEXT),
        })
      ).hasCv,
    ).toBe(true);

    // Nouveau navigateur : rien en mémoire, on relit et déverrouille.
    const stored = await client.fetch();
    expect(stored?.hasCv).toBe(true);
    const unlocked = await client.unlock(stored!, PASSPHRASE);
    expect(unlocked.identity).toEqual(identity);
    const cv = await client.downloadCv(unlocked);
    expect(cv.name).toBe(CV_NAME);
    expect(new TextDecoder().decode(cv.bytes)).toBe(CV_TEXT);

    await expect(client.unlock(stored!, "pas la bonne phrase")).rejects.toThrow();

    const changed = await client.changePassphrase(unlocked, PASSPHRASE, NEW_PASSPHRASE);
    expect(changed.revision).toBe(unlocked.revision + 1);
    const afterChange = await client.fetch();
    await expect(client.unlock(afterChange!, PASSPHRASE)).rejects.toThrow();
    expect((await client.unlock(afterChange!, NEW_PASSPHRASE)).identity).toEqual(identity);

    const recovered = await client.recover(afterChange!, recoveryKey, PASSPHRASE);
    expect(recovered.identity).toEqual(identity);
    expect((await client.unlock((await client.fetch())!, PASSPHRASE)).identity).toEqual(identity);
  });

  it("aucune requête ne contient de donnée d'identité, de phrase ni de clé en clair", () => {
    expect(requests.length).toBeGreaterThanOrEqual(8);
    const writes = requests.filter((r) => r.method !== "GET");
    expect(writes.some((r) => r.path === "/api/vault/cv" && r.method === "PUT")).toBe(true);
    for (const request of requests) {
      expectNoSecret(readable(request.body), [...SECRETS, recoveryKey]);
      // Même sans tirets, la clé de secours n'est jamais transmise.
      expect(readable(request.body)).not.toContain(recoveryKey.replace(/-/g, ""));
    }
    // Les requêtes JSON ne portent que les champs opaques attendus.
    for (const request of writes.filter((r) => r.path === "/api/vault" && r.body.length)) {
      const keys = Object.keys(JSON.parse(request.body.toString("utf8")) as object).sort();
      for (const key of keys) {
        expect([
          "confirm",
          "identity",
          "kdf",
          "keys",
          "passphraseWrappedKey",
          "recoveryWrappedKey",
          "revision",
          "version",
        ]).toContain(key);
      }
    }
  });

  it("la base ne stocke que des octets illisibles", async () => {
    const row = await db.identityVault.findUniqueOrThrow({ where: { userId: alice.id } });
    const dump = [
      row.identityCiphertext,
      row.cvCiphertext,
      row.passphraseWrappedKey,
      row.recoveryWrappedKey,
      row.kdfSalt,
    ]
      .map((b) => Buffer.from(b ?? new Uint8Array()).toString("latin1"))
      .join("\n");
    expectNoSecret(dump);
    expect(row.kdfIterations).toBeGreaterThanOrEqual(600_000);
  });

  it("l'export RGPD contient le coffre, chiffré", async () => {
    asUser(alice);
    const response = await exportRoute();
    const data = (await response.json()) as { identityVault: { identity: string; cv: string } };
    expect(data.identityVault.identity).toBeTruthy();
    expect(data.identityVault.cv).toBeTruthy();
    expectNoSecret(JSON.stringify(data));
  });

  it("le coffre est cloisonné : Bob reçoit un 404 et ne peut rien modifier", async () => {
    asUser(bob);
    expect(await client.fetch()).toBeNull();
    const status = async (route: Handler, init?: RequestInit) =>
      (await route(new Request("http://test/api/vault", init))).status;
    expect(await status(vaultRoute.GET as unknown as Handler)).toBe(404);
    expect(await status(cvRoute.GET as unknown as Handler)).toBe(404);
    expect(await status(cvRoute.DELETE as unknown as Handler)).toBe(404);
    const aliceVault = await db.identityVault.findUniqueOrThrow({ where: { userId: alice.id } });
    expect(
      await status(vaultRoute.PUT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: aliceVault.revision, identity: null }),
      }),
    ).toBe(404);
    expect(
      await status(vaultRoute.DELETE, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }),
    ).toBe(404);
    expect(
      await status(cvRoute.PUT, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(64).fill(1),
      }),
    ).toBe(404);
    // Le coffre d'Alice est intact.
    const after = await db.identityVault.findUniqueOrThrow({ where: { userId: alice.id } });
    expect(after.revision).toBe(aliceVault.revision);
    expect(after.identityCiphertext).toEqual(aliceVault.identityCiphertext);
  });

  it("refuse les requêtes non authentifiées, mal formées ou en conflit", async () => {
    asUser(null);
    expect((await vaultRoute.GET()).status).toBe(401);
    asUser(alice);
    const put = (body: unknown, contentType = "application/json") =>
      vaultRoute.PUT(
        new Request("http://test/api/vault", {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: JSON.stringify(body),
        }),
      );
    // Révision périmée : on n'écrase pas une version plus récente.
    expect((await put({ revision: 0, identity: null })).status).toBe(409);
    // Pas un chiffré du coffre (texte en base64 sans en-tête de version).
    const current = (await client.fetch())!;
    const plainB64 = Buffer.from(JSON.stringify(identity)).toString("base64");
    expect((await put({ revision: current.revision, identity: plainB64 })).status).toBe(400);
    // Formulaire (requête « simple » possible depuis un autre site) : refusé.
    expect((await put({ revision: current.revision }, "text/plain")).status).toBe(400);
    // Paramètres de dérivation affaiblis : refusés.
    expect(
      (
        await put({
          revision: current.revision,
          keys: {
            kdf: { ...current.kdf, iterations: 1000 },
            passphraseWrappedKey: current.passphraseWrappedKey,
          },
        })
      ).status,
    ).toBe(400);
    // Second coffre : jamais écrasé.
    const created = await vaultRoute.POST(
      new Request("http://test/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: current.version,
          kdf: current.kdf,
          passphraseWrappedKey: current.passphraseWrappedKey,
          recoveryWrappedKey: current.recoveryWrappedKey,
        }),
      }),
    );
    expect(created.status).toBe(409);
    await expect(client.destroy().then(() => client.fetch())).resolves.toBeNull();
    await expect(client.downloadCv({} as never)).rejects.toBeInstanceOf(VaultHttpError);
  });

  it("les journaux du serveur ne contiennent aucune donnée d'identité", () => {
    expect(logLines.some((line) => line.includes("vault.created"))).toBe(true);
    expectNoSecret(logLines.join("\n"), [...SECRETS, recoveryKey]);
  });
});
