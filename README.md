# Coach Career IA

Agent de carrière privé en mode **« reverse sourcing »** : le candidat constitue une
**mémoire de carrière** fondée sur des preuves, fixe des **garde-fous** non négociables
(salaire plancher, télétravail, secteurs exclus…), et un moteur IA ne lui apporte que les
opportunités qualifiées. Plus tard, des profils anonymisés seront présentés aux recruteurs ;
le candidat lève l'anonymat en un clic, offre par offre.

La v1 est un outil réservé aux candidats.

**La confidentialité est le produit** :

- chaque requête est filtrée par l'utilisateur courant (`requireUser()`) ;
- les champs identifiants (nom, coordonnées, employeur) sont séparés du profil partageable
  et chiffrés au niveau applicatif (`src/lib/crypto`) ;
- aucune donnée personnelle dans les logs (`src/lib/logger.ts`) ;
- les secrets ne viennent que de l'environnement.

## Stack

- Next.js 16 (App Router) + TypeScript strict + Tailwind CSS 4
- PostgreSQL 17 + pgvector, Prisma 7 (adaptateur `pg`)
- Auth.js v5 : connexion sans mot de passe par lien magique (SMTP), sessions en base
- zod pour la validation, Vitest pour les tests, ESLint + Prettier
- Docker (image Next.js standalone) derrière Traefik

## Démarrage local

Prérequis : Node.js 22+, Docker.

```bash
cp .env.example .env
# Renseigner AUTH_SECRET et DATA_ENCRYPTION_KEY :
#   openssl rand -base64 32

npm install            # génère aussi le client Prisma
npm run db:up          # PostgreSQL + pgvector sur 127.0.0.1:${POSTGRES_PORT:-5433}
npm run db:migrate     # applique les migrations
npm run db:seed        # compte de démonstration (demo@coach-career.test)
npm run dev            # http://localhost:3000 (PORT=xxxx pour changer)
```

**Connexion en développement** : sans `SMTP_HOST`, le lien magique est affiché dans la console
du serveur (`[dev] Lien de connexion…`). Ouvrez-le dans le navigateur pour vous connecter.
Pour tester un vrai envoi, un SMTP local type Mailpit (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`)
convient.

### Scripts npm

| Script                   | Rôle                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `npm run dev`            | serveur de développement                                          |
| `npm run build`          | build de production (standalone)                                  |
| `npm start`              | lance le build                                                    |
| `npm run lint`           | ESLint + vérification Prettier                                    |
| `npm run format`         | formate le code avec Prettier                                     |
| `npm run typecheck`      | génère les types de routes Next.js puis `tsc --noEmit`            |
| `npm test`               | tests Vitest (unitaires + intégration si `TEST_DATABASE_URL`)     |
| `npm run db:up` / `down` | démarre / arrête la base de dev (`docker-compose.dev.yml`)        |
| `npm run db:migrate`     | applique les migrations (`prisma migrate deploy`)                 |
| `npm run db:migrate:dev` | crée une nouvelle migration après modification du schéma          |
| `npm run db:seed`        | données de démonstration (idempotent, ignoré en production)       |
| `npm run db:generate`    | régénère le client Prisma (`src/generated/prisma`, non versionné) |

## Variables d'environnement

Toutes sont documentées dans [`.env.example`](.env.example).

| Variable                                                              | Requis   | Description                                              |
| --------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| `DATABASE_URL`                                                        | oui      | URL PostgreSQL                                           |
| `TEST_DATABASE_URL`                                                   | tests    | base distincte pour les tests d'intégration              |
| `POSTGRES_PORT`                                                       | dev      | port hôte de la base de dev (5433 par défaut)            |
| `POSTGRES_USER` / `_PASSWORD` / `_DB`                                 | prod     | identifiants du conteneur PostgreSQL                     |
| `AUTH_SECRET`                                                         | oui      | secret Auth.js (≥ 32 caractères)                         |
| `AUTH_URL`                                                            | prod     | URL publique (`https://<SITE_DOMAIN>`)                   |
| `EMAIL_FROM`                                                          | prod     | expéditeur des e-mails                                   |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` | prod     | serveur SMTP du lien magique                             |
| `DATA_ENCRYPTION_KEY`                                                 | oui      | clé AES-256 (32 octets base64) du chiffrement applicatif |
| `DATA_ENCRYPTION_KEY_VERSION`                                         | non (1)  | version de la clé courante                               |
| `DATA_ENCRYPTION_PREVIOUS_KEYS`                                       | rotation | anciennes clés `1:<base64>,2:<base64>`                   |
| `LOG_LEVEL`                                                           | non      | `debug`, `info`, `warn`, `error`                         |
| `SITE_DOMAIN`                                                         | prod     | domaine servi par Traefik                                |
| `TRAEFIK_NETWORK`                                                     | prod     | réseau Docker externe de Traefik                         |
| `TRAEFIK_ENTRYPOINT`                                                  | prod     | entrypoint Traefik (`websecure`)                         |
| `TRAEFIK_CERTRESOLVER`                                                | prod     | resolver de certificats (`letsencrypt`)                  |
| `APP_MEM_LIMIT`, `WORKER_MEM_LIMIT`, `POSTGRES_MEM_LIMIT`             | non      | limites mémoire des conteneurs                           |

## Base de données et migrations

- Schéma : `prisma/schema.prisma`, configuration Prisma : `prisma.config.ts`.
- La première migration (`20261007000000_enable_pgvector`) active l'extension `vector`.
- Nouvelle migration : modifier le schéma puis `npm run db:migrate:dev -- --name <nom>`.
- En production, le service `migrate` applique `prisma migrate deploy` avant le démarrage de
  l'app.

**Règle d'isolation** : toute table métier référence `users.id`, et toute requête passe par
l'utilisateur renvoyé par `requireUser()` :

```ts
const user = await requireUser();
const items = await db.someModel.findMany({ where: { userId: user.id } });
```

## Authentification

- Lien magique valable 15 minutes, à usage unique (jeton haché en base).
- Sessions persistées en base (déconnexion = révocation immédiate), 30 jours.
- `src/proxy.ts` redirige `/app/*` vers `/connexion` sans cookie de session ; la vérification
  qui fait foi est `requireUser()` (`src/lib/auth/session.ts`), appelée dans chaque page et
  action protégée.

## Chiffrement applicatif

`src/lib/crypto` chiffre les champs sensibles en AES-256-GCM. Format :
`v<version>:<iv>:<tag>:<chiffré>`. Le paramètre `aad` lie un chiffré à son contexte
(ex. `user:<id>:email`).

Rotation de clé :

1. générer une nouvelle clé, la placer dans `DATA_ENCRYPTION_KEY` et incrémenter
   `DATA_ENCRYPTION_KEY_VERSION` ;
2. déplacer l'ancienne dans `DATA_ENCRYPTION_PREVIOUS_KEYS` (`1:<ancienne clé>`) ;
3. rechiffrer les valeurs pour lesquelles `needsReEncryption()` est vrai, puis retirer
   l'ancienne clé.

## Tests

`npm test` lance Vitest. Les tests d'intégration utilisent une base PostgreSQL + pgvector
dédiée (`TEST_DATABASE_URL`) : en local, `docker-compose.dev.yml` crée `coach_career_test` ;
en CI, un service `pgvector/pgvector:pg17`. Les migrations y sont appliquées
(`migrate deploy`, jamais de remise à zéro destructive) et les tests restent rejouables. Sans
`TEST_DATABASE_URL`, seuls les tests unitaires s'exécutent.

## Déploiement sur le VPS

L'application tourne derrière le Traefik existant : **aucun port publié**, l'app rejoint le
réseau externe `TRAEFIK_NETWORK` et ses labels Traefik sont générés depuis l'environnement.

```bash
git clone … && cd coach-career-ia
cp .env.example .env    # renseigner les valeurs de production
docker compose build
docker compose up -d    # postgres → migrate (one-shot) → app + worker
docker compose logs -f app
```

Services (`docker-compose.yml`) :

- `app` : Next.js standalone (port interne 3000), labels Traefik, `mem_limit` ;
- `migrate` : applique les migrations puis s'arrête ;
- `worker` : placeholder des futures tâches de fond (collecte, matching, e-mails) ;
- `postgres` : `pgvector/pgvector:pg17`, volume `pgdata`, réseau interne uniquement.

Sauvegarde de la base : `docker compose exec postgres pg_dump -U coach coach_career > sauvegarde.sql`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) : installation, lint, typecheck, tests (avec un
service PostgreSQL + pgvector), migration + seed sur base vierge, build, et build des images
Docker (sans push).
