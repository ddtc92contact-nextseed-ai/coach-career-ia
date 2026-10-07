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
- next-intl : 6 langues (fr par défaut, en, es, it, de, nl), routes préfixées `/fr`, `/en`…
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
npm run dev            # http://localhost:3000 → redirige vers /fr (ou la langue du navigateur)
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
| `npm run i18n:check`     | vérifie que les 6 langues ont les mêmes clés (CI)                 |
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
| `UPLOAD_DIR`                                                          | non      | dossier privé des justificatifs (`./storage/uploads`)    |
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
- L'e-mail est rédigé dans la langue de la page où le lien a été demandé (sinon la préférence
  du compte, sinon le français).
- Sessions persistées en base (déconnexion = révocation immédiate), 30 jours.
- `src/proxy.ts` redirige `/<langue>/app/*` vers `/<langue>/connexion` sans cookie de session ;
  la vérification qui fait foi est `requireUser()` (`src/lib/auth/session.ts`), appelée dans
  chaque page et action protégée.

## Langues (next-intl)

Six langues : **français (source, par défaut)**, anglais, espagnol, italien, allemand,
néerlandais (`src/i18n/routing.ts`).

- Toutes les pages vivent sous `src/app/[locale]/` : `/fr/…`, `/en/…`. `/` et toute URL sans
  préfixe redirigent vers la meilleure langue : cookie `NEXT_LOCALE`, puis `Accept-Language`,
  puis français. Chaque page a `<html lang>`, un lien canonique et ses alternatives `hreflang`
  (balises `<link>` et en-tête `Link`).
- Sélecteur de langue dans l'en-tête et dans **Paramètres** ; connecté, le choix est enregistré
  dans `users.locale`.
- Dates, nombres et montants passent par les formateurs next-intl et les formats nommés de
  `src/i18n/formats.ts` : `format.number(45000, "salary")` donne `45 000 €` en français et
  `€45,000` en anglais.
- Texte produit hors de l'interface (e-mails, futurs textes de l'IA) : utiliser
  `getUserLocale(userId)` (`src/lib/i18n/user-locale.ts`).
- Les codes stockés en base (secteurs, contrats, culture…) s'affichent via `codes.<famille>.<CODE>`.

### Ajouter un texte

1. Ajouter la clé dans `messages/fr.json`, dans le namespace de la page (`memory`, `guardRails`…).
2. L'utiliser : `const t = useTranslations("memory")` (composant) ou
   `await getTranslations("memory")` (serveur), puis `t("maCle")`. Les clés sont typées : une clé
   absente du français ne compile pas.
3. Ajouter la même clé, traduite, dans les cinq autres fichiers `messages/*.json` (en, es, it, de,
   nl). Variables (`{count}`), pluriels ICU et balises (`<link>`) doivent être identiques.
4. `npm run i18n:check` (et la CI) échoue si une clé manque, est en trop, ou si les variables
   diffèrent. Utiliser l'apostrophe typographique `’` : `'` est un caractère d'échappement ICU.

Les erreurs de validation zod sont des **codes** (`required`, `tooLong`…), traduits à
l'affichage via `errors.<code>`.

### Ajouter une langue

1. Ajouter le code dans `LOCALES` et son nom dans `LOCALE_NAMES` (`src/i18n/routing.ts`).
2. Créer `messages/<code>.json` (copie traduite de `fr.json`) et l'importer dans
   `src/i18n/messages.ts`.
3. `npm run i18n:check && npm test` : la parité des clés, les formats et le proxy sont vérifiés.

## Mémoire de carrière et garde-fous

Profil **pseudonymisé** : aucun nom d'employeur, de personne ni coordonnée n'a de champ (un test
le vérifie sur le schéma). Les données identifiantes relèvent du coffre d'identité (#4).

| Modèle              | Contenu                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Experience`        | poste, début/fin (au mois), niveau, contrat, employeur décrit par secteur, taille et stade, responsabilités                            |
| `Achievement`       | titre, contexte, ce que j'ai fait, résultat mesurable, expérience liée, niveau de preuve                                               |
| `Proof`             | lien, document privé chiffré, ou témoignage écrit                                                                                      |
| `Skill`             | compétence ; niveau et dernière utilisation calculés depuis les réalisations                                                           |
| `GuardRails`        | salaire fixe minimum, package visé, télétravail, contrats, secteurs et entreprises exclus (chiffrées), heures max, astreintes, culture |
| `GuardRailLocation` | ville acceptée + rayon (coordonnées réservées au futur géocodage)                                                                      |
| `CareerProfile`     | statut de visibilité : `ACTIVE`, `OPEN`, `INVISIBLE`                                                                                   |

- Accès aux données : `src/lib/career/repository.ts`. Chaque fonction prend `userId` et filtre
  toutes ses requêtes par lui ; un élément d'un autre utilisateur est « introuvable ».
- Niveau de preuve : `DOCUMENT` dès qu'une preuve est jointe, `DECLARED` sinon (`VERIFIED`
  réservé à une vérification future). Niveau de compétence : non prouvée → déclarée →
  démontrée (1 réalisation prouvée) → confirmée (2-3) → maîtrisée (4+).
- Complétude du tableau de bord (`computeCompleteness`) : les réalisations prouvées pèsent le
  plus.
- Brouillon pour l'import IA : schéma zod partagé `CareerMemoryDraft`
  (`src/lib/career/schemas.ts`).

### Pièces justificatives

PDF, PNG, JPEG ou WebP (type détecté sur le contenu), 5 Mo maximum, 30 documents par compte.
Les fichiers sont chiffrés (AES-256-GCM, `DATA_ENCRYPTION_KEY`) dans `UPLOAD_DIR`, jamais servis
statiquement. Téléchargement uniquement via `GET /api/proofs/<id>`, réservé au propriétaire (404
pour les autres), sans cache. En production, le volume Docker `uploads` est monté sur
`/app/storage/uploads` : le sauvegarder avec la base.

### Export et suppression (RGPD)

Dans **Paramètres** :

- `GET /api/account/export` : toutes les données du compte en JSON (garde-fous déchiffrés,
  documents en base64) ;
- suppression du compte confirmée par la saisie de l'adresse e-mail : toutes les tables
  (cascade sur `users.id`, sessions comprises) puis tous les fichiers de l'utilisateur.

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

Les tests d'intégration de `tests/db/career-isolation.test.ts` vérifient l'isolation entre
utilisateurs (lecture, modification, suppression, téléchargement de documents), le chiffrement
des entreprises exclues et des fichiers, l'export et la suppression complète du compte.

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

- `app` : Next.js standalone (port interne 3000), labels Traefik, `mem_limit`, volume `uploads`
  (pièces justificatives chiffrées) ;
- `migrate` : applique les migrations puis s'arrête ;
- `worker` : placeholder des futures tâches de fond (collecte, matching, e-mails) ;
- `postgres` : `pgvector/pgvector:pg17`, volume `pgdata`, réseau interne uniquement.

Sauvegarde de la base : `docker compose exec postgres pg_dump -U coach coach_career > sauvegarde.sql`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) : installation, lint, parité des traductions, typecheck, tests (avec un
service PostgreSQL + pgvector), migration + seed sur base vierge, build, et build des images
Docker (sans push).
