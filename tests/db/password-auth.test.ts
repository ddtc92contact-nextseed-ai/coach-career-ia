import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Comptes à mot de passe, de bout en bout : client navigateur → vraies routes
 * → base de test. On vérifie que le mot de passe n'atteint jamais le serveur,
 * que la base ne garde qu'un hachage lent, et le cycle complet inscription →
 * vérification → connexion → coffre ouvert → réinitialisation.
 */

const url = process.env.TEST_DATABASE_URL;
process.env.AUTH_SECRET ??= "secret-de-test-auth-0123456789-abcdefghijklmnop";
process.env.DATABASE_URL ??= url ?? "postgresql://absent/absent";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));

/** E-mails « envoyés » : on y lit les liens de vérification et de réinitialisation. */
const mails: { to: string; kind: string; url: string }[] = [];
vi.mock("@/lib/auth/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/mailer")>()),
  sendAccountEmail: vi.fn(async (mail: { to: string; kind: string; url: string }) => {
    mails.push(mail);
  }),
}));

const { db } = await import("@/lib/db");
const { getCurrentUser } = await import("@/lib/auth/session");
const { createAccountClient } = await import("@/lib/auth/account-client");
type AccountError = import("@/lib/auth/account-client").AccountError;
const { createVaultClient } = await import("@/lib/vault/client");
const { matchesAccount, deriveAccountKeys } = await import("@/lib/vault/crypto");
const { confirmEmail } = await import("@/lib/auth/accounts");
const { consumeToken, issueToken } = await import("@/lib/auth/tokens");
const { identityData } = await import("@/lib/vault/identity");

type Handler = (request: Request) => Promise<Response>;
const route = async (path: string) => (await import(path)) as Record<string, Handler>;
const routes: Record<string, Record<string, Handler>> = {
  "/api/account/prelogin": await route("@/app/api/account/prelogin/route"),
  "/api/account/login": await route("@/app/api/account/login/route"),
  "/api/account/signup": await route("@/app/api/account/signup/route"),
  "/api/account/verify": await route("@/app/api/account/verify/route"),
  "/api/account/reset/request": await route("@/app/api/account/reset/request/route"),
  "/api/account/reset": await route("@/app/api/account/reset/route"),
  "/api/account/password": await route("@/app/api/account/password/route"),
  "/api/account/password/verify": await route("@/app/api/account/password/verify/route"),
  "/api/vault": await route("@/app/api/vault/route"),
};

type Captured = { path: string; body: string; status: number; setCookie: string | null };
const requests: Captured[] = [];
const logLines: string[] = [];
let ip = "test";

async function routedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  headers.set("x-forwarded-for", ip);
  const request = new Request(`http://test${input}`, { method, headers, body: init.body });
  const body = await request.clone().text();
  const handler = routes[input]?.[method];
  const response = handler ? await handler(request) : new Response(null, { status: 405 });
  requests.push({
    path: input,
    body,
    status: response.status,
    setCookie: response.headers.get("set-cookie"),
  });
  return response;
}

const accounts = createAccountClient(routedFetch);
const vaults = createVaultClient(routedFetch);

const PASSWORD = "Ma phrase de connexion très secrète";
const NEW_PASSWORD = "Une autre phrase, toute neuve 42";
const RESET_PASSWORD = "Après la réinitialisation 2026";
const PASSWORDS = [PASSWORD, NEW_PASSWORD, RESET_PASSWORD];
const identity = identityData.parse({ firstName: "Héloïse", lastName: "Vasquez-Moreau" });

const emailFor = (label: string) =>
  `${label}-${Date.now()}-${randomBytes(3).toString("hex")}@exemple.test`;
const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
const lastMail = (to: string, kind: string) =>
  mails.filter((m) => m.to === to && m.kind === kind).at(-1);

async function asUser(email: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, email: true },
  });
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  return user;
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as AccountError;
  }
  throw new Error("aurait dû échouer");
}

/** Inscription + vérification de l'adresse (lien de l'e-mail). */
async function verifiedAccount(label: string, password = PASSWORD) {
  const email = emailFor(label);
  await accounts.signup(email, password, "fr");
  expect(await confirmEmail(tokenOf(lastMail(email, "verifyEmail")!.url))).toBe(true);
  return email;
}

describe.skipIf(!url)("connexion par e-mail + mot de passe", { timeout: 120_000 }, () => {
  const created: string[] = [];

  beforeAll(() => {
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map(String).join(" "));
      });
    }
  });

  beforeEach(() => {
    // Une IP par test : les limites par IP ne débordent pas d'un test à l'autre.
    // Base jamais remise à zéro : une IP inédite à chaque exécution.
    ip = `test-${randomBytes(6).toString("hex")}`;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await db.user.deleteMany({ where: { email: { contains: "-pwd-" } } });
    await db.$disconnect();
  });

  it("parcours : inscription → vérification → connexion → coffre ouvert → reconnexion", async () => {
    const email = emailFor("alice-pwd-");
    await accounts.signup(email, PASSWORD, "fr");
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    created.push(user.id);
    expect(user.emailVerified).toBeNull();
    expect(user.termsVersion).not.toBeNull();

    // Compte non vérifié : bon mot de passe, mais pas de session.
    const unverified = await rejection(accounts.login(email, PASSWORD, true));
    expect(unverified.code).toBe("unverified");
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);

    // Lien de l'e-mail : `/fr/inscription/confirmer?token=…`, à usage unique.
    const link = lastMail(email, "verifyEmail")!.url;
    expect(link).toMatch(/\/fr\/inscription\/confirmer\?token=/);
    expect(await confirmEmail(tokenOf(link))).toBe(true);
    expect(await confirmEmail(tokenOf(link))).toBe(false);

    const key = await accounts.login(email, PASSWORD, true);
    const login = requests.filter((r) => r.path === "/api/account/login").at(-1)!;
    expect(login.status).toBe(200);
    expect(login.setCookie).toMatch(
      /authjs\.session-token=[\w-]+; Path=\/; HttpOnly; SameSite=Lax/,
    );
    expect(login.setCookie).toMatch(/Expires=/);
    const token = login.setCookie!.split(";")[0]!.split("=")[1]!;
    const session = await db.session.findUniqueOrThrow({ where: { sessionToken: token } });
    expect(session.userId).toBe(user.id);

    // Premier passage dans l'espace : le coffre se crée avec la clé du compte, sans phrase.
    await asUser(email);
    const { vault } = await vaults.setupWithAccount(key.vaultKey, key.kdf);
    await vaults.saveIdentity(vault, identity);

    // Déconnexion (session supprimée) puis reconnexion : le coffre s'ouvre directement.
    await db.session.deleteMany({ where: { userId: user.id } });
    const again = await accounts.login(email, PASSWORD, false);
    const second = requests.filter((r) => r.path === "/api/account/login").at(-1)!;
    expect(second.setCookie).not.toMatch(/Expires=/); // « Rester connecté » décoché
    const stored = await vaults.fetch();
    expect(matchesAccount(stored!, again.kdf)).toBe(true);
    expect((await vaults.unlockWithAccount(stored!, again.vaultKey)).identity).toEqual(identity);
  });

  it("le serveur ne reçoit jamais le mot de passe, la base n'a qu'un hachage lent", async () => {
    const all = requests.map((r) => r.body).join("\n");
    for (const password of PASSWORDS) expect(all).not.toContain(password);
    for (const r of requests.filter((r) => r.path.startsWith("/api/account/") && r.body)) {
      const keys = Object.keys(JSON.parse(r.body) as object);
      for (const key of keys) {
        expect([
          "email",
          "authHash",
          "currentAuthHash",
          "kdf",
          "remember",
          "acceptTerms",
          "locale",
          "callbackUrl",
          "token",
          "vault",
        ]).toContain(key);
      }
    }
    const users = await db.user.findMany({
      where: { id: { in: created } },
      select: { passwordHash: true },
    });
    const sent = requests
      .flatMap((r) => (r.body ? [JSON.parse(r.body) as { authHash?: string }] : []))
      .map((b) => b.authHash)
      .filter(Boolean) as string[];
    for (const { passwordHash } of users) {
      expect(passwordHash).toMatch(/^scrypt\$/);
      for (const hash of sent) expect(passwordHash).not.toContain(hash);
      for (const password of PASSWORDS) expect(passwordHash).not.toContain(password);
    }
    // Ni mot de passe, ni hash, ni jeton dans les journaux.
    const logs = logLines.join("\n");
    for (const password of PASSWORDS) expect(logs).not.toContain(password);
    for (const hash of sent) expect(logs).not.toContain(hash);
    for (const mail of mails) expect(logs).not.toContain(tokenOf(mail.url) ?? "absent");
  });

  it("mauvais mot de passe et adresse inconnue : même réponse générique", async () => {
    const email = await verifiedAccount("bob-pwd-");
    const wrong = await rejection(accounts.login(email, "pas le bon mot de passe", false));
    const unknown = await rejection(accounts.login(emailFor("personne-pwd-"), PASSWORD, false));
    expect(wrong.code).toBe("invalidCredentials");
    expect(unknown.code).toBe("invalidCredentials");
    const [a, b] = requests.filter((r) => r.path === "/api/account/login").slice(-2);
    expect(a!.status).toBe(b!.status);
    expect(a!.body.length).toBeGreaterThan(0);

    // Les paramètres de dérivation ne trahissent pas l'existence du compte.
    const prelogin = async (address: string) => {
      const response = await routedFetch("/api/account/prelogin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      });
      return (await response.json()) as { kdf: { name: string; iterations: number; salt: string } };
    };
    const ghost = emailFor("fantome-pwd-");
    const [real, fake, fakeAgain] = [
      await prelogin(email),
      await prelogin(ghost),
      await prelogin(ghost),
    ];
    expect(Object.keys(fake.kdf).sort()).toEqual(Object.keys(real.kdf).sort());
    expect(fake.kdf.iterations).toBe(real.kdf.iterations);
    expect(fake.kdf.salt).toHaveLength(real.kdf.salt.length);
    expect(fakeAgain.kdf.salt).toBe(fake.kdf.salt);

    // Inscription avec une adresse déjà prise : même réponse, un e-mail au titulaire.
    await accounts.signup(email, "un autre mot de passe ici", "fr");
    expect(lastMail(email, "accountExists")).toBeDefined();
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await accounts.login(email, PASSWORD, false)).toBeTruthy();
    expect(user.emailVerified).not.toBeNull();
  });

  it("verrouillage après 5 échecs, même avec le bon mot de passe ensuite", async () => {
    const email = await verifiedAccount("carol-pwd-");
    for (let i = 0; i < 5; i++) {
      expect(
        (await rejection(accounts.login(email, `mauvais ${i} mot de passe`, false))).code,
      ).toBe("invalidCredentials");
    }
    const locked = await rejection(accounts.login(email, PASSWORD, false));
    expect(locked.code).toBe("rateLimited");
    expect(locked.status).toBe(429);
    expect(locked.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);

    // Limite par IP sur l'inscription.
    ip = `flood-${randomBytes(6).toString("hex")}`;
    for (let i = 0; i < 10; i++) await accounts.signup(emailFor(`flood${i}-pwd-`), PASSWORD, "fr");
    const flooded = await rejection(accounts.signup(emailFor("flood-pwd-"), PASSWORD, "fr"));
    expect(flooded.code).toBe("rateLimited");
  });

  it("mot de passe oublié : jeton de 30 min, à usage unique ; le coffre exige la clé de secours", async () => {
    const email = await verifiedAccount("dave-pwd-");
    const key = await accounts.login(email, PASSWORD, false);
    const user = await asUser(email);
    const { vault, recoveryKey } = await vaults.setupWithAccount(key.vaultKey, key.kdf);
    await vaults.saveIdentity(vault, identity);

    await accounts.requestReset(email, "en");
    const link = lastMail(email, "resetPassword")!.url;
    expect(link).toMatch(/\/en\/connexion\/nouveau-mot-de-passe\?token=/);
    // Adresse inconnue : même réponse, aucun e-mail.
    const before = mails.length;
    await accounts.requestReset(emailFor("inconnu-pwd-"), "fr");
    expect(mails.length).toBe(before);

    // Jeton expiré.
    const expired = await issueToken(user.id, "RESET_PASSWORD", new Date(Date.now() - 31 * 60_000));
    expect((await rejection(accounts.resetPassword(expired, RESET_PASSWORD))).code).toBe(
      "invalidToken",
    );

    await accounts.requestReset(email, "fr");
    const token = tokenOf(lastMail(email, "resetPassword")!.url);
    await accounts.resetPassword(token, RESET_PASSWORD);
    // Réutilisation refusée.
    expect(
      (await rejection(accounts.resetPassword(token, "encore un autre mot de passe"))).code,
    ).toBe("invalidToken");
    // Toutes les sessions ont été fermées ; l'ancien mot de passe ne marche plus.
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await rejection(accounts.login(email, PASSWORD, false))).code).toBe(
      "invalidCredentials",
    );

    const fresh = await accounts.login(email, RESET_PASSWORD, false);
    const stored = await vaults.fetch();
    // Le coffre n'a pas suivi : seule la clé de secours le rouvre.
    expect(matchesAccount(stored!, fresh.kdf)).toBe(false);
    await expect(vaults.unlockWithAccount(stored!, fresh.vaultKey)).rejects.toThrow();
    const recovered = await vaults.bindToAccount(
      stored!,
      { recoveryKey },
      fresh.vaultKey,
      fresh.kdf,
    );
    expect(recovered.identity).toEqual(identity);
    const reopened = await vaults.unlockWithAccount((await vaults.fetch())!, fresh.vaultKey);
    expect(reopened.identity).toEqual(identity);
  });

  it("jetons : expiration et usage unique", async () => {
    const email = await verifiedAccount("erin-pwd-");
    const { id } = await db.user.findUniqueOrThrow({ where: { email } });
    const now = new Date();
    const token = await issueToken(id, "RESET_PASSWORD", now);
    expect(await consumeToken(token, "VERIFY_EMAIL", now)).toBeNull(); // mauvais type
    expect(
      await consumeToken(token, "RESET_PASSWORD", new Date(now.getTime() + 31 * 60_000)),
    ).toBeNull();
    expect(await consumeToken(token, "RESET_PASSWORD", now)).toBe(id);
    expect(await consumeToken(token, "RESET_PASSWORD", now)).toBeNull();
    // Un nouveau jeton invalide le précédent.
    const first = await issueToken(id, "RESET_PASSWORD");
    await issueToken(id, "RESET_PASSWORD");
    expect(await consumeToken(first, "RESET_PASSWORD")).toBeNull();
  });

  it("changement de mot de passe : coffre ré-enveloppé, ancien mot de passe refusé", async () => {
    const email = await verifiedAccount("frank-pwd-");
    const key = await accounts.login(email, PASSWORD, false);
    await asUser(email);
    const { vault } = await vaults.setupWithAccount(key.vaultKey, key.kdf);
    const saved = await vaults.saveIdentity(vault, identity);

    // Mauvais mot de passe actuel : refus avant tout envoi du coffre.
    expect(
      (
        await rejection(
          accounts.setPassword({
            current: "pas le bon",
            next: NEW_PASSWORD,
            vault: { material: saved.material, revision: saved.revision },
          }),
        )
      ).code,
    ).toBe("invalidCurrent");

    // Sans ré-enveloppement, le serveur refuse : le coffre deviendrait illisible.
    const kdf = key.kdf;
    const current = await deriveAccountKeys(PASSWORD, kdf);
    const bare = await routedFetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAuthHash: current.authHash,
        authHash: (await deriveAccountKeys(NEW_PASSWORD, kdf)).authHash,
        kdf,
      }),
    });
    expect(bare.status).toBe(409);

    const result = await accounts.setPassword({
      current: PASSWORD,
      next: NEW_PASSWORD,
      vault: { material: saved.material, revision: saved.revision },
    });
    expect(result.vault?.revision).toBe(saved.revision + 1);
    expect((await rejection(accounts.login(email, PASSWORD, false))).code).toBe(
      "invalidCredentials",
    );
    const next = await accounts.login(email, NEW_PASSWORD, false);
    const reopened = await vaults.unlockWithAccount((await vaults.fetch())!, next.vaultKey);
    expect(reopened.identity).toEqual(identity);
  });

  it("migration : compte à lien magique avec un ancien coffre à phrase secrète", async () => {
    // Compte existant (lien magique) : vérifié, sans mot de passe, coffre à phrase.
    const email = emailFor("manager-pwd-");
    await db.user.create({ data: { email, emailVerified: new Date() } });
    await asUser(email);
    const legacy = await vaults.setup("ancienne phrase secrète du coffre");
    await vaults.saveIdentity(legacy.vault, identity);

    // Pas de mot de passe : la connexion par mot de passe échoue comme une adresse inconnue.
    expect((await rejection(accounts.login(email, PASSWORD, false))).code).toBe(
      "invalidCredentials",
    );

    // Premier mot de passe défini depuis les Paramètres (le coffre ne bouge pas encore).
    const set = await accounts.setPassword({ current: null, next: PASSWORD, vault: null });
    expect(set.vault).toBeNull();
    // Un second « premier » mot de passe exige l'actuel.
    expect(
      (await rejection(accounts.setPassword({ current: null, next: NEW_PASSWORD, vault: null })))
        .code,
    ).toBe("currentRequired");

    // Un coffre « lié au compte » aux mauvais paramètres est refusé par le serveur.
    const stored = await vaults.fetch();
    const other = await deriveAccountKeys(PASSWORD, {
      ...set.key.kdf,
      salt: Buffer.alloc(16, 1).toString("base64"),
    });
    await expect(
      vaults.bindToAccount(
        stored!,
        { passphrase: "ancienne phrase secrète du coffre" },
        other.vaultKey,
        {
          ...set.key.kdf,
          salt: Buffer.alloc(16, 1).toString("base64"),
        },
      ),
    ).rejects.toThrow();

    // Une seule fois : l'ancienne phrase ré-enveloppe la clé avec le mot de passe.
    const bound = await vaults.bindToAccount(
      stored!,
      { passphrase: "ancienne phrase secrète du coffre" },
      set.key.vaultKey,
      set.key.kdf,
    );
    expect(bound.identity).toEqual(identity);

    // Désormais : connexion par mot de passe, coffre ouvert sans phrase.
    const key = await accounts.login(email, PASSWORD, false);
    const reopened = await vaults.unlockWithAccount((await vaults.fetch())!, key.vaultKey);
    expect(reopened.identity).toEqual(identity);
    await expect(
      vaults.unlock((await vaults.fetch())!, "ancienne phrase secrète du coffre"),
    ).rejects.toThrow();
  });

  it("vérification du mot de passe avant d'envelopper le coffre", async () => {
    const email = await verifiedAccount("gina-pwd-");
    await asUser(email);
    const kdf = await accounts.accountKdf();
    await expect(accounts.deriveKey("pas le bon", kdf!, true)).rejects.toMatchObject({
      code: "invalidCurrent",
    });
    expect((await accounts.deriveKey(PASSWORD, kdf!, true)).kdf).toEqual(kdf);
  });
  it("prise de contrôle avant inscription : le lien magique de la victime efface le mot de passe de l'attaquant", async () => {
    const email = emailFor("victime-pwd-");
    const ATTACKER = "mot de passe de l'attaquant";
    await accounts.signup(email, ATTACKER, "fr");
    expect((await rejection(accounts.login(email, ATTACKER, false))).code).toBe("unverified");
    const { id } = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await db.authToken.count({ where: { userId: id } })).toBe(1);

    // La victime se connecte par lien magique : Auth.js appelle `updateUser` avec `emailVerified`.
    const { PrismaAdapter } = await import("@auth/prisma-adapter");
    const { secureAdapter } = await import("@/lib/auth/adapter");
    const adapter = secureAdapter(PrismaAdapter(db));
    const updated = await adapter.updateUser!({ id, emailVerified: new Date() });
    expect(updated).not.toHaveProperty("passwordHash");
    expect(updated).not.toHaveProperty("kdfSalt");

    const user = await db.user.findUniqueOrThrow({ where: { id } });
    expect(user.emailVerified).not.toBeNull();
    expect(user.passwordHash).toBeNull();
    expect(user.kdfSalt).toBeNull();
    expect(user.kdfIterations).toBeNull();
    expect(await db.authToken.count({ where: { userId: id } })).toBe(0);

    // L'authHash de l'attaquant, rejoué tel quel, est refusé.
    const signupBody = requests
      .filter((r) => r.path === "/api/account/signup" && r.body.includes(email))
      .at(-1)!;
    const { authHash } = JSON.parse(signupBody.body) as { authHash: string };
    const replay = await routedFetch("/api/account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, authHash, remember: false }),
    });
    expect(replay.status).toBe(401);
    expect(await db.session.count({ where: { userId: id } })).toBe(0);

    // Un compte déjà vérifié garde son mot de passe lors d'une connexion par lien magique.
    const owner = await verifiedAccount("proprietaire-pwd-");
    const ownerRow = await db.user.findUniqueOrThrow({ where: { email: owner } });
    await adapter.updateUser!({ id: ownerRow.id, emailVerified: new Date() });
    expect(await accounts.login(owner, PASSWORD, false)).toBeTruthy();
  });

  it("/api/auth/session n'expose ni hachage, ni sel, ni jeton de session", async () => {
    const email = await verifiedAccount("session-pwd-");
    await accounts.login(email, PASSWORD, false);
    const cookie = requests
      .filter((r) => r.path === "/api/account/login")
      .at(-1)!
      .setCookie!.split(";")[0]!;
    const { handlers } = await import("@/auth");
    const { NextRequest } = await import("next/server");
    const response = await handlers.GET(
      new NextRequest("http://localhost/api/auth/session", { headers: { cookie } }),
    );
    const text = await response.text();
    const session = JSON.parse(text) as { user?: Record<string, unknown> };
    expect(session.user?.email).toBe(email);
    expect(Object.keys(session).sort()).toEqual(["expires", "user"]);
    expect(Object.keys(session.user!).sort()).toEqual(["email", "id"]);
    for (const forbidden of [
      "passwordHash",
      "kdfSalt",
      "kdfIterations",
      "sessionToken",
      "scrypt",
      "stripe",
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).not.toContain(cookie.split("=")[1]!);
  });
});
