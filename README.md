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
| `npm run radar:run`      | un passage du Market Radar sur toutes les sources                 |
| `npm run ai:eval`        | fixtures de l'import IA passées au vrai fournisseur (manuel)      |
| `npm run worker`         | worker de tâches de fond (radar planifié)                         |
| `npm run geo:backfill`   | géocode les offres ouvertes encore sans coordonnées               |

## Variables d'environnement

Toutes sont documentées dans [`.env.example`](.env.example).

| Variable                                                              | Requis   | Description                                               |
| --------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `DATABASE_URL`                                                        | oui      | URL PostgreSQL                                            |
| `TEST_DATABASE_URL`                                                   | tests    | base distincte pour les tests d'intégration               |
| `POSTGRES_PORT`                                                       | dev      | port hôte de la base de dev (5433 par défaut)             |
| `POSTGRES_USER` / `_PASSWORD` / `_DB`                                 | prod     | identifiants du conteneur PostgreSQL                      |
| `AUTH_SECRET`                                                         | oui      | secret Auth.js (≥ 32 caractères)                          |
| `AUTH_URL`                                                            | prod     | URL publique (`https://<SITE_DOMAIN>`)                    |
| `EMAIL_FROM`                                                          | prod     | expéditeur des e-mails                                    |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` | prod     | serveur SMTP du lien magique                              |
| `DATA_ENCRYPTION_KEY`                                                 | oui      | clé AES-256 (32 octets base64) du chiffrement applicatif  |
| `DATA_ENCRYPTION_KEY_VERSION`                                         | non (1)  | version de la clé courante                                |
| `DATA_ENCRYPTION_PREVIOUS_KEYS`                                       | rotation | anciennes clés `1:<base64>,2:<base64>`                    |
| `UPLOAD_DIR`                                                          | non      | dossier privé des justificatifs (`./storage/uploads`)     |
| `NEXT_PUBLIC_VAULT_IDLE_MINUTES`                                      | non (15) | verrouillage auto. du coffre (min, lu au build)           |
| `LOG_LEVEL`                                                           | non      | `debug`, `info`, `warn`, `error`                          |
| `ADMIN_EMAILS`                                                        | non      | e-mails admin (virgules) : `/app/radar` et Premium offert |
| `RADAR_CONTACT`                                                       | radar    | contact (URL ou `mailto:`) du User-Agent du radar         |
| `RADAR_INTERVAL_HOURS`, `RADAR_RUN_ON_START`                          | non      | périodicité du worker (6 h) et passage au démarrage       |
| `RADAR_COUNTRIES`                                                     | non (FR) | pays conservés (ISO-2, `*` = tous)                        |
| `RADAR_COMPANIES_FILE`                                                | non      | entreprises suivies (`config/radar-companies.json`)       |
| `RADAR_MIN_INTERVAL_MS`                                               | non      | délai minimal entre requêtes vers un même hôte (1000)     |
| `FRANCE_TRAVAIL_CLIENT_ID`, `FRANCE_TRAVAIL_CLIENT_SECRET`            | non      | identifiants partenaire France Travail (sinon ignorée)    |
| `RADAR_FT_ROME_CODES`, `RADAR_FT_KEYWORDS`, `RADAR_FT_DEPARTMENTS`    | non      | critères de recherche France Travail                      |
| `RADAR_FT_MAX_RESULTS`                                                | non      | plafond d'offres par recherche (1050, max 3150)           |
| `RADAR_HEALTH_FAILURE_THRESHOLD`                                      | non (3)  | échecs consécutifs avant alerte « source en panne »       |
| `GEO_ENABLED`, `GEO_NOMINATIM_ENABLED`                                | non      | géocodage (BAN, puis Nominatim hors de France)            |
| `GEO_BAN_URL`, `GEO_NOMINATIM_URL`                                    | non      | points d'accès (Géoplateforme IGN, OSM ou auto-hébergé)   |
| `GEO_NOMINATIM_MAX_PER_RUN`, `GEO_TIMEOUT_MS`                         | non      | plafond Nominatim par passage (200), délai (5000 ms)      |
| `AI_PROVIDER`                                                         | non      | `mistral` (défaut), `openai-compatible` ou `mock`         |
| `MISTRAL_API_KEY`                                                     | import   | clé API Mistral (sinon l'import IA est désactivé)         |
| `MISTRAL_CHAT_MODEL`, `MISTRAL_EMBED_MODEL`, `MISTRAL_BASE_URL`       | non      | `mistral-small-latest`, `mistral-embed`, URL de l'API     |
| `OPENAI_COMPAT_BASE_URL`, `_API_KEY`, `_CHAT_MODEL`, `_EMBED_MODEL`   | non      | endpoint compatible OpenAI (Ollama local…)                |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`                                     | non      | délai par tentative (45 s) et reprises (2)                |
| `COACH_MESSAGES_PER_DAY`                                              | non (40) | offre gratuite : messages au coach sur 24 h (0 = Premium) |
| `CONTACT_DAILY_LIMIT`                                                 | non (5)  | prises de contact envoyées par candidat sur 24 h          |
| `CONTACT_EMAIL_FROM`                                                  | non      | expéditeur des prises de contact (défaut : `EMAIL_FROM`)  |
| `CARD_LINK_TTL_DAYS`                                                  | non (30) | durée de validité des liens de carte anonyme (jours)      |
| `STRIPE_SECRET_KEY`                                                   | paiement | clé secrète Stripe (sinon paiements indisponibles)        |
| `STRIPE_WEBHOOK_SECRET`                                               | paiement | secret de signature du webhook (`whsec_…`)                |
| `STRIPE_PRICE_PREMIUM_MONTHLY`                                        | paiement | prix mensuel récurrent de Premium (`price_…`)             |
| `GITHUB_TOKEN`                                                        | non      | jeton GitHub (lecture publique) pour l'import GitHub      |
| `SITE_DOMAIN`                                                         | prod     | domaine servi par Traefik                                 |
| `TRAEFIK_NETWORK`                                                     | prod     | réseau Docker externe de Traefik                          |
| `TRAEFIK_ENTRYPOINT`                                                  | prod     | entrypoint Traefik (`websecure`)                          |
| `TRAEFIK_CERTRESOLVER`                                                | prod     | resolver de certificats (`letsencrypt`)                   |
| `APP_MEM_LIMIT`, `WORKER_MEM_LIMIT`, `POSTGRES_MEM_LIMIT`             | non      | limites mémoire des conteneurs                            |

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

## Market Radar (collecte d'offres)

Le radar collecte des offres **uniquement auprès de sources autorisées** et se comporte en
client identifié et poli. Code : `src/lib/radar`.

- **Sources** :
  - API France Travail « Offres d'emploi v2 » (OAuth2 client credentials, critères ROME /
    mots-clés / départements, pagination dans les limites documentées : 150 par page, index ≤
    3149). Sans identifiants, la source est ignorée.
  - Job boards ATS publics des entreprises de `config/radar-companies.json` : Greenhouse
    (`boards-api.greenhouse.io`), Lever (`api.lever.co`, `region: "eu"` pour
    `api.eu.lever.co`), Ashby (`api.ashbyhq.com/posting-api`), SmartRecruiters (Posting API
    `api.smartrecruiters.com/v1/companies/{id}/postings`, paginée + une requête par annonce),
    Recruitee (`{entreprise}.recruitee.com/api/offers/` du site carrière) et Workable (widget
    public `apply.workable.com/api/v1/widget/accounts/{compte}?details=true`, hôte limité à
    une requête toutes les 5 s). Pour ces trois derniers, robots.txt est vérifié avant
    l'appel.
  - **SmartRecruiters — décision en attente** : le robots.txt de `api.smartrecruiters.com`
    n'autorise que LinkedInBot (`User-agent: * / Disallow: /`), bien que l'API soit documentée
    comme publique. Le connecteur respecte ce robots.txt : les entreprises SmartRecruiters
    sont livrées `"active": false` et une source activée échouerait avec « robots.txt
    interdit ». À activer après accord de SmartRecruiters (ou levée de la règle).
  - Hors périmètre : LinkedIn, Indeed, Glassdoor, Welcome to the Jungle (CGU interdisant la
    collecte automatisée). Aucune source n'est « scrapée ».
- **Client poli** (`http.ts`) : User-Agent `CoachCareerIA-Radar/1.0 (+RADAR_CONTACT)`, débit
  limité par hôte, nouvelles tentatives espacées sur 429/5xx (respect de `Retry-After`),
  requêtes conditionnelles `ETag` / `Last-Modified`, robots.txt vérifié pour toute URL hors
  API. Pas de navigateur headless, de proxy ni d'usurpation d'agent.
- **Pipeline** (`pipeline.ts`) : chaque connecteur fait `fetch → map` vers le schéma commun
  (`JobOffer`), puis upsert idempotent par `(source, sourceId)` avec empreinte de contenu.
  Une offre absente d'une collecte **complète** de son périmètre passe en `CLOSED` (et rouvre
  si elle revient). Dédoublonnage inter-sources par URL d'origine ou entreprise + intitulé
  normalisé + ville : l'offre de l'ATS de l'employeur est canonique, les autres pointent vers
  elle (`duplicateOfId`).
- **Salaire** : uniquement s'il est annoncé (`salary.ts` lit « 45-55 k€ », « 50 000 € annuel »,
  mensuel, journalier, horaire, variable, BSPCE) ; sinon `null`, jamais estimé.
- **Robustesse** : chaque périmètre (France Travail, `greenhouse:dataiku`…) est journalisé
  dans `SourceRun` ; une source en échec est consignée et n'arrête pas les autres.
- **Santé des sources** (`health.ts`, section de `/app/radar`) : par périmètre, dernier
  passage, statut, compteurs (reçues / créées / fermées / doublons), dernière erreur, dernier
  succès, et alerte quand les `RADAR_HEALTH_FAILURE_THRESHOLD` (3) derniers passages ont
  échoué (également journalisée : `radar.source.unhealthy`).
- **Canal de candidature** (`apply.ts`) : seul le canal publié POUR CANDIDATER est conservé —
  courriel et URL de postulation France Travail, URL de candidature des ATS (Greenhouse,
  Lever, Ashby, SmartRecruiters, Recruitee, Workable), adresse annoncée dans le texte
  (« Envoyez votre CV à … »). Jamais le nom, le téléphone ni l'adresse postale d'un recruteur.
  Une adresse qui semble nominative (`prenom.nom@…`) est conservée mais marquée : elle ne sert
  qu'à l'envoi, n'est jamais affichée ni journalisée.
- **Données personnelles** : les logs ne contiennent que des compteurs et des erreurs
  nettoyées.
- **Exécution** : `npm run radar:run` (un passage), ou le service `worker` (toutes les
  `RADAR_INTERVAL_HOURS`). Suivi : `/app/radar`, réservé à `ADMIN_EMAILS`.
- **Tests** : tous sur des fixtures enregistrées (`tests/fixtures/radar`), jamais sur le
  réseau.

### Ajouter une entreprise au radar

Une entrée dans `config/radar-companies.json` (vérifiée au chargement ; `slug` unique, en
minuscules). Vérifier d'abord que l'entreprise publie bien ses offres sur l'ATS, via son
endpoint public (une requête manuelle suffit) :

| `ats`             | `boardToken`                                   | Où le trouver / vérifier                                                                      |
| ----------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `greenhouse`      | jeton du board (`dataiku`)                     | `job-boards.greenhouse.io/{jeton}` ; `boards-api.greenhouse.io/v1/boards/{jeton}/jobs`        |
| `lever`           | site Lever (`qonto`), `region: "eu"` si besoin | `jobs.lever.co/{site}` ou `jobs.eu.lever.co/{site}` ; `api.lever.co/v0/postings/{site}`       |
| `ashby`           | nom du board (`alan`)                          | `jobs.ashbyhq.com/{board}` ; `api.ashbyhq.com/posting-api/job-board/{board}`                  |
| `smartrecruiters` | identifiant, sensible à la casse (`Nexity`)    | `careers.smartrecruiters.com/{id}` (l'API est exclue par son robots.txt)                      |
| `recruitee`       | sous-domaine (`matera`)                        | `{sous-domaine}.recruitee.com` ; `{sous-domaine}.recruitee.com/api/offers/`                   |
| `workable`        | compte (`exotec`)                              | `apply.workable.com/{compte}` ; `apply.workable.com/api/v1/widget/accounts/{compte}` (`jobs`) |

```json
{
  "slug": "exotec",
  "name": "Exotec",
  "website": "https://www.exotec.com",
  "sector": "Robotique / logistique",
  "ats": "workable",
  "boardToken": "exotec"
}
```

`"active": false` garde l'entreprise en base sans la collecter (une entreprise retirée du
fichier est désactivée de la même façon). `npm run radar:run` prend la liste en compte au
passage suivant.

### Géocodage (filtre de distance)

Le garde-fou de lieu (« ville X + rayon N km ») est un filtre dur du matching : offres et
lieux du candidat reçoivent des coordonnées. Code : `src/lib/geo`.

- **Fournisseurs**, derrière une interface commune (`GeocodingProvider`) :
  - **Base Adresse Nationale** pour la France (métropole et outre-mer) : géocodeur officiel,
    gratuit, sans clé. Servi depuis 2025 par la Géoplateforme de l'IGN
    (`data.geopf.fr/geocodage/search`) ; l'ancienne adresse `api-adresse.data.gouv.fr` est
    décommissionnée. Recherche limitée aux communes, filtrée par code commune INSEE ou code
    postal quand la source les donne. Sa réponse fait foi : une commune introuvable n'est pas
    redemandée ailleurs.
  - **Nominatim** (OpenStreetMap) pour les autres pays, ou une saisie sans pays que la BAN ne
    reconnaît pas. Sa [politique d'usage](https://operations.osmfoundation.org/policies/nominatim/)
    est respectée : 1 requête/s au plus, User-Agent identifiant, cache, plafond de requêtes par
    passage (`GEO_NOMINATIM_MAX_PER_RUN`), pas de géocodage en masse. Données © les
    contributeurs d'OpenStreetMap (ODbL). `GEO_NOMINATIM_URL` permet une instance
    auto-hébergée ; `GEO_NOMINATIM_ENABLED=false` le désactive.
  - Choix écarté : un jeu de données statique de villes (à maintenir, couverture partielle).
- **Client poli** : même client que le radar (`http.ts`), User-Agent
  `CoachCareerIA-Geo/1.0 (+RADAR_CONTACT ou AUTH_URL)`, délai de 5 s, un seul nouvel essai.
  Sans contact configuré, le géocodage est désactivé (rien n'est envoyé).
- **Cache persistant** (`geo_cache`) : clé normalisée (pays, code commune, code postal, ville
  sans accents ni casse) → coordonnées, pays, précision. Une ville n'est jamais géocodée deux
  fois ; un lieu introuvable est retenté après 30 jours. La table ne référence aucun
  utilisateur.
- **Offres** (`JobOffer.latitude` / `longitude` / `geocodedAt`) : les coordonnées fournies par
  France Travail sont reprises telles quelles ; sinon la ville est géocodée à la création ou
  quand le lieu change. Sans ville (région ou pays seul, « Remote »), aucune coordonnée n'est
  inventée. Après chaque passage, le worker rattrape les offres ouvertes encore sans
  géocodage (`npm run geo:backfill` pour le lancer à la main). `/app/radar` affiche la part
  des offres ouvertes géolocalisées.
- **Garde-fous** : chaque lieu est géocodé côté serveur à l'enregistrement. En cas d'échec, le
  lieu est enregistré sans coordonnées et le formulaire l'indique (message traduit).
- **Robustesse** : le géocodeur ne lève jamais ; un fournisseur en panne est mis de côté
  quelques minutes (disjoncteur). Ni un passage du radar ni l'enregistrement des garde-fous
  n'échouent à cause du géocodage.
- **Confidentialité** : les lieux des garde-fous sont des données du candidat : ni libellé,
  ni coordonnées, ni URL de requête ne sont journalisés (seulement fournisseur, type
  d'erreur et compteurs).
- **Pour le matching** : `distanceKm(a, b)` (haversine) et `isWithinRadius(offre, lieux)`
  (`src/lib/geo/distance.ts`, purs). Sans coordonnées, une offre ne correspond à aucun lieu ;
  le cas du télétravail complet relève du moteur de matching.

## Couche IA et import du parcours

### Couche IA (`src/lib/ai`)

Une interface unique, indépendante du fournisseur, pour le chat (multi-tours, sortie JSON,
appel d'outils) et les embeddings. Le coach IA s'appuie sur `runTools()` et les messages `tool`.

- **Fournisseurs** (`AI_PROVIDER`) : Mistral par défaut (`MISTRAL_API_KEY`), tout endpoint
  compatible OpenAI (Ollama local), et un simulateur déterministe (`createMockProvider`). Sous
  Vitest, le simulateur est imposé et `fetch` est bloqué (`tests/setup/no-network.ts`) : aucun
  test n'appelle un modèle, GitHub ni le réseau.
- **Robustesse** : délai par tentative, reprises avec temporisation exponentielle sur
  délai / 5xx / 429 (`Retry-After` respecté), erreurs converties en codes (`timeout`,
  `unavailable`…).
- **Sortie structurée** : `generateObject()` valide la réponse par zod et fait une seule tentative
  de réparation en renvoyant les erreurs au modèle.
- **Embeddings** : par lots, avec cache mémoire (clé = modèle + empreinte du texte).
- **Journal** : fournisseur, modèle, usage, durée, jetons et coût estimé (`src/lib/ai/pricing.ts`).
  Jamais le contenu des prompts ni des réponses.
- **Langue** : les textes générés suivent `getUserLocale()` (`languageInstruction()`).
- Côté serveur : `getAiClient()` (`src/lib/ai/server.ts`, protégé par `server-only`).

### Import « Importer mon parcours » (`/app/memoire/importer`)

Sources : CV PDF/DOCX (5 Mo), archive RGPD LinkedIn (ZIP, 20 Mo ; seuls les CSV Profile,
Positions, Education, Skills, Projects, Certifications, e-mails et téléphones sont décompressés,
5 Mo max chacun ; les messages ne sont jamais lus), dépôts publics GitHub (6 max : langages,
étoiles, description, extrait du README).

1. `POST /api/import` lit les fichiers **en mémoire** : rien n'est écrit sur disque ni en base.
   Type détecté sur le contenu, tailles limitées, 10 imports par heure et par utilisateur.
2. Avant le modèle : e-mails, téléphones et liens de profil sont masqués ; les noms du profil
   LinkedIn ne sont pas envoyés.
3. Le modèle produit un brouillon (`CareerMemoryDraft`) où les employeurs sont décrits par
   secteur, taille et stade, et signale les détails rares qui pourraient ré-identifier le
   candidat.
4. Après le modèle : tout nom repéré (candidat, employeurs, écoles, clients, pseudo GitHub)
   encore présent est remplacé par `[…]` et l'élément est signalé. Les données identifiantes
   forment une charge **séparée**, renvoyée au seul navigateur (destinée au coffre d'identité #4 ;
   en attendant, oubliée à la fin de la revue).
5. Le candidat accepte, modifie ou rejette chaque expérience, réalisation et compétence. Seuls les
   éléments acceptés sont enregistrés (`importDraft`, une transaction) ; une réalisation démarre au
   niveau `DECLARED`, ou `DOCUMENT` si une preuve (dépôt GitHub…) est jointe.

Panne ou lenteur du fournisseur : message traduit et bouton « Réessayer » ; le navigateur
abandonne après 135 s (budget serveur : 120 s).

**Évaluation** : `tests/fixtures/import` contient 4 profils fictifs (CV français en DOCX, anglais et
allemand en PDF, export LinkedIn + GitHub) avec la réponse simulée du modèle et le brouillon
attendu. `tests/unit/import-pipeline.test.ts` vérifie le résultat et l'absence de nom, contact,
employeur ou école dans le brouillon. `npm run ai:eval` passe ces fixtures au vrai fournisseur
configuré et affiche un tableau (expériences, dates, codes, rappel des compétences, fuites).

## Coach IA (`/app/coach`)

Un agent conversationnel, présenté comme une IA, qui apprend à connaître le candidat et enrichit sa
mémoire de carrière **uniquement par des suggestions qu'il valide**.

- **Compétences** (choisies au début d'une conversation, `src/lib/coach/prompts.ts`) : chacune est
  une consigne système et une liste d'outils autorisés.
  - « Découvrir mon profil » : entretien STAR (situation, tâche, action, résultat chiffré, lien de
    preuve) → `read_career_memory`, `propose_achievement`, `propose_experience_update`,
    `propose_skill` ;
  - « Clarifier ce que je veux » : salaire, lieu, télétravail, contrats, secteurs →
    `read_career_memory`, `propose_guard_rail_change` ;
  - « Préparer un entretien » : simulation avec retours → `read_career_memory` seul.
- **Outils** (`src/lib/coach/tools.ts`) : `read_career_memory` renvoie le profil **pseudonymisé**
  (expériences, réalisations, compétences, garde-fous ; jamais l'e-mail ni les entreprises
  exclues). Les outils `propose_*` créent une `CoachSuggestion` **en attente**, affichée comme une
  carte « Accepter / Modifier / Rejeter ». Seule `acceptSuggestion()` écrit dans la mémoire, après
  revalidation zod (le contenu modifié par le candidat aussi).
- **Garde-fous** : la consigne interdit d'inventer expériences, chiffres ou preuves et de demander
  nom, employeur ou coordonnées. Indépendamment du modèle, chaque suggestion est pseudonymisée
  (`src/lib/coach/redact.ts`) : e-mails, téléphones, liens, parties du nom du compte, entreprises
  exclues et noms signalés par le modèle (`identifyingTerms`) sont remplacés par `[…]` ; un lien de
  profil (LinkedIn…) n'est jamais une preuve. La carte signale ces retraits.
- **Tour de conversation** : `POST /api/coach/conversations/:id/messages` enregistre d'abord le
  message (rien n'est perdu si le fournisseur tombe), puis diffuse la réponse en NDJSON
  (`accepted`, `status`, `suggestion`, `delta`, `done` ou `error`). Boucle d'outils limitée à 6
  étapes et 90 s ; le navigateur abandonne à 105 s. Panne, lenteur ou sortie vide : erreur
  traduite dans le fil et bouton « Réessayer » (`{ "retry": true }` relance le dernier message,
  sans le décompter, 3 fois au plus par message). Un seul tour à la fois par conversation
  (verrou atomique `turn_started_at`) : un envoi ou une relance simultanés reçoivent 409. Les
  suggestions d'un tour échoué sont abandonnées.
- **Données** : `CoachConversation`, `CoachMessage` (texte **chiffré**, AAD
  `user:<id>:coach-message`), `CoachSuggestion` ; suppression en cascade avec la conversation ou
  le compte, incluses dans l'export RGPD. La conversation d'un autre utilisateur répond 404.
- **Quota** : offre gratuite, `COACH_MESSAGES_PER_DAY` messages par utilisateur sur 24 h
  glissantes (40 par défaut ; 0 = coach réservé à Premium) ; **Premium est illimité**. La limite
  vient des droits de l'utilisateur (`getEntitlements()`, voir « Abonnements »). Comptée en base
  sous un verrou transactionnel par utilisateur (`pg_advisory_xact_lock`) : des envois simultanés
  ne peuvent pas la dépasser ; à 0, les relances sont aussi refusées. Limite atteinte : encart
  d'information (pas une erreur) qui propose Premium quand le paiement est disponible.
- **Langue** : le coach répond dans la langue de l'utilisateur (`getUserLocale()`).
- **Journal** : compteurs (étapes, suggestions, durée) et codes d'erreur ; jamais le texte des
  messages.
- **Diffusion** : la couche fournisseur ne diffuse pas encore les jetons ; la progression (réflexion,
  lecture de la mémoire, suggestion) et les cartes arrivent au fil de l'eau, la réponse finale par
  morceaux.

Tests : `tests/db/coach.test.ts` (séquence d'outils scriptée, acceptation / rejet, pannes,
isolation, quota, cascade, journaux) et `tests/unit/coach.test.ts`, avec le fournisseur simulé.

## Abonnements (Stripe, `/app/billing`)

Modèle freemium côté candidat : le compte est gratuit, les fonctions avancées sont dans
**Premium** (abonnement mensuel). Première fonction Premium : **coach IA illimité**.

- **Droits** (`src/lib/billing/entitlements.ts`) : seul endroit qui traduit une offre en
  fonctionnalités. Toute fonction payante appelle `getEntitlements(userId)`
  (`src/lib/billing/server.ts`) puis `hasFeature(entitlements, "coach.unlimited")` ou lit
  `entitlements.limits` — jamais `user.plan` dans un composant. Les adresses de `ADMIN_EMAILS` sont
  Premium sans abonnement (comptes de test du gérant).
- **Données** : sur `users`, `plan` (`FREE` par défaut, comptes existants compris),
  `subscription_status`, `current_period_end`, `cancel_at_period_end`, `stripe_customer_id`,
  `stripe_subscription_id` ; table `stripe_events` (évènements déjà traités). La facturation des
  entreprises (phase 2) aura ses propres modèles, rattachés à l'entreprise.
- **Paiement** : « Passer à Premium » crée (une fois) un client Stripe puis une session
  **Checkout** hébergée ; « Gérer mon abonnement » ouvre le **portail client** Stripe (moyen de
  paiement, factures, résiliation). Aucune donnée de carte ne passe par nos serveurs. Stripe ne
  reçoit que l'e-mail de connexion et l'identifiant du compte (métadonnées `userId`) — jamais la
  mémoire de carrière ni le coffre d'identité.
- **Webhook** `POST /api/stripe/webhook` : signature vérifiée (400 sinon), évènements
  `checkout.session.completed`, `customer.subscription.created/updated/deleted`,
  `invoice.payment_failed`. L'offre est **toujours dérivée de l'état chez Stripe** : l'abonnement
  concerné est relu (`subscriptions.retrieve`), ce qui rend l'ordre d'arrivée sans importance.
  Statuts `active`, `trialing`, `past_due` (relances de paiement en cours) → Premium ; tout le
  reste → gratuit. Chaque évènement est enregistré dans `stripe_events` dans la même transaction
  que la mise à jour : un évènement rejoué est sans effet ; en cas d'erreur, rien n'est enregistré
  et Stripe renvoie l'évènement.
- **Suppression du compte** : le client Stripe est supprimé d'abord (abonnement résilié, e-mail
  effacé chez Stripe) ; si Stripe est injoignable, la suppression est refusée et peut être
  relancée.
- **Sans configuration** (une des trois variables `STRIPE_*` absente) : build et application
  normaux, la page « Abonnement » indique que les paiements ne sont pas encore disponibles, le
  webhook répond 503 ; personne n'est bloqué (offre gratuite).

Mise en service :

1. Stripe → Produits : créer « Premium » avec un **prix récurrent mensuel** → `STRIPE_PRICE_PREMIUM_MONTHLY`.
2. Développeurs → Webhooks : point de terminaison `https://<SITE_DOMAIN>/api/stripe/webhook`, avec
   les cinq évènements ci-dessus → `STRIPE_WEBHOOK_SECRET`.
3. Paramètres → Portail client : activer la résiliation et la mise à jour du moyen de paiement.
4. En local : `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

Tests (`tests/unit/billing.test.ts`, `tests/db/billing.test.ts`) : Stripe simulé, seule la
vérification de signature du SDK est réelle (fixtures `tests/fixtures/stripe` signées en local) ;
aucun appel à l'API Stripe.

## Carte anonyme et prise de contact (Stealth Proxy)

Le candidat ne contacte une entreprise que par le **canal de candidature publié dans l'offre**
(pas de portail recruteur, aucune recherche de contacts personnels). Code : `src/lib/card`,
`src/lib/contact`.

- **Carte anonyme** (`/app/carte`) : générée par règles depuis la mémoire PSEUDONYMISÉE (jamais
  depuis le coffre) — accroche, séniorité, années d'expérience, réalisations clés (les mieux
  prouvées, résultats chiffrés, niveau de preuve), compétences issues des réalisations, résumé
  des garde-fous (salaire plancher arrondi, télétravail, contrats, zone). Le candidat la relit,
  la modifie et la **valide** ; toute modification retire la validation.
- **Contrôle de ré-identification** (`reidentify.ts`, déterministe), refait avant CHAQUE partage
  (validation, envoi, texte à coller, ouverture du lien) : coordonnées, liens, liens de profil
  personnel (et tout lien de preuve tant que le candidat ne les autorise pas), employeurs
  (« chez X », raison sociale, entreprises connues du radar, entreprises exclues), écoles,
  dates (jour, mois, année : « intitulé rare + dates exactes » ré-identifie), parties de
  l'e-mail du compte. Coffre déverrouillé, le même contrôle tourne **dans le navigateur** avec
  le nom, les employeurs, les écoles et les liens du coffre (rien n'est envoyé au serveur).
- **Lien public** `/<langue>/p/<jeton>` : jeton aléatoire de 256 bits dont seule l'empreinte
  SHA-256 est stockée, expirant (`CARD_LINK_TTL_DAYS`), révocable depuis `/app/carte`,
  `noindex` (méta + `X-Robots-Tag`), `no-store`, `Referrer-Policy: no-referrer`. Jeton inconnu,
  expiré, révoqué ou carte non partageable : 404 sans distinction.
- **Prise de contact** (« Contacter cette entreprise » sur une opportunité) : l'agent rédige un
  court message dans la **langue de l'offre** (détectée par mots-outils, sans IA), à partir de
  la seule carte validée et des faits de la correspondance ; sortie JSON validée par zod, texte
  re-contrôlé (repli sur un modèle déterministe si l'IA échoue ou ré-identifierait le candidat).
  Cycle : brouillon → **approbation explicite** (liée au texte exact) → envoi à la demande.
  Rien n'est jamais envoyé automatiquement. L'e-mail part du SMTP de l'application, depuis
  l'adresse de la plateforme, et indique qu'il a été préparé par un agent IA pour une personne
  candidate anonyme qui l'a approuvé (AI Act, art. 50), avec les liens de la carte et de
  réponse. Offre sans adresse : le texte et le lien sont préparés pour que le candidat les colle
  lui-même sur la page « Postuler » (aucun formulaire rempli automatiquement).
- **Garde-fous et quotas** : impossible pour une offre qui viole un garde-fou dur (revérifié à
  l'approbation et à l'envoi), une seule prise de contact par offre, `CONTACT_DAILY_LIMIT`
  envois par 24 h glissantes ; historique complet (canal, date, texte envoyé chiffré).
- **Réponses** : l'e-mail renvoie vers `/<langue>/p/<jeton>/repondre`, ouverte seulement par le
  jeton d'un contact envoyé ; la réponse (chiffrée) arrive dans `/app/contacts`, et le candidat
  est prévenu par e-mail sans le contenu. Levée d'anonymat : à venir
  (`Contact.handoverRequestedAt`, mention sur la page du contact).
- **Confidentialité** : textes des contacts et réponses chiffrés (AAD `user:<id>:contact`,
  `user:<id>:contact-reply`) ; journal limité aux codes et au canal (ni identité, ni contenu,
  ni adresse de l'entreprise).

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
| `GuardRailLocation` | ville acceptée + rayon, coordonnées géocodées à l’enregistrement (voir « Géocodage »)                                                  |
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

## Coffre d'identité (zéro connaissance)

L'identité réelle du candidat (prénom, nom, e-mail et téléphone montrés aux recruteurs, noms
réels des employeurs et écoles, liens identifiants, CV d'origine) est chiffrée **dans le
navigateur** : le serveur ne stocke que des blobs qu'il ne peut pas lire. Page :
`/app/identite` (« Mon identité »).

- Cryptographie : `src/lib/vault/crypto.ts`, WebCrypto uniquement. Clé de données
  AES-256-GCM aléatoire ; enveloppée par une clé dérivée de la phrase secrète
  (PBKDF2-SHA256, 600 000 itérations, sel de 16 octets) et par une clé de secours de 256 bits
  (52 caractères base32 Crockford), affichée une seule fois, téléchargeable et imprimable. Les
  AAD lient chaque chiffré à son usage (identité, CV, enveloppes) ; l'identité est complétée à
  256 octets pour ne pas trahir la longueur des noms ; le nom et le type du CV sont chiffrés
  avec son contenu.
- Le client refuse des paramètres affaiblis renvoyés par le serveur (< 600 000 itérations).
- Clé déverrouillée : `CryptoKey` non exportable, en mémoire React uniquement
  (`src/components/vault/vault-provider.tsx`), effacée au verrouillage, à la déconnexion, au
  rechargement et après inactivité (5 à 60 min au choix ; défaut
  `NEXT_PUBLIC_VAULT_IDLE_MINUTES`). Seule cette durée est mémorisée en `localStorage`.
- Changement de phrase : seule l'enveloppe change, les données ne sont pas rechiffrées.
  Phrase oubliée : la clé de secours permet d'en définir une nouvelle. Les deux perdues :
  données irrécupérables ; le coffre peut seulement être réinitialisé (supprimé).
- Mémoire de carrière : le nom réel de l'employeur s'affiche sous l'expérience quand le coffre
  est déverrouillé, par jointure sur l'identifiant d'expérience dans le navigateur.
- Modèle `IdentityVault` (table `identity_vaults`, 1-1 avec `users`, cascade) : version,
  paramètres KDF, deux clés enveloppées, identité chiffrée, CV chiffré, `revision` (verrou
  optimiste : 409 si le coffre a changé ailleurs ; le navigateur relit alors le coffre, le
  déchiffre avec la clé déjà en mémoire et remet le formulaire à jour).
- API (blobs opaques, toujours le coffre de l'utilisateur connecté) : sans coffre,
  `GET /api/vault` renvoie `200` + `null`, les autres appels un 404 :
  `GET|POST|PUT|DELETE /api/vault` (JSON exigé) et `GET|PUT|DELETE /api/vault/cv`
  (`application/octet-stream`, 5 Mo + en-tête). L'export RGPD inclut le coffre, chiffré.

Tests : `tests/unit/vault-crypto.test.ts` (aller-retour, mauvaise phrase, clé de secours,
changement de phrase, altérations) ; `tests/db/identity-vault.test.ts` exécute le client du
coffre contre les vraies routes, vérifie qu'aucune requête, ligne en base ni ligne de journal ne
contient de donnée d'identité, de phrase ou de clé, que l'utilisateur B ne peut ni lire ni modifier
le coffre de A, et qu'un enregistrement réussit après un conflit 409 ; `tests/unit/vault-storage.test.ts` interdit tout autre usage du stockage
navigateur.

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
- `worker` : tâches de fond (Market Radar planifié), image dédiée (cible Docker `worker`) ;
  `RADAR_CONTACT` est requis ;
- `postgres` : `pgvector/pgvector:pg17`, volume `pgdata`, réseau interne uniquement.

Sauvegarde de la base : `docker compose exec postgres pg_dump -U coach coach_career > sauvegarde.sql`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) : installation, lint, parité des traductions, typecheck, tests (avec un
service PostgreSQL + pgvector), migration + seed sur base vierge, build, et build des images
Docker (sans push).
