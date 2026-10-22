# Matching

Moteur de correspondance candidat ↔ offres : garde-fous (`filters.ts`, `prefilter.ts`), score
(`score.ts`), embeddings pgvector (`embeddings.ts`), recalcul par le worker (`recompute.ts`) et
explications (`explanation.ts`). Ce document couvre l'**audit du classement** et le **banc de
profils de référence** (issue #78).

## Audit d'un candidat (`npm run matching:audit`)

Rejoue le score d'un candidat sur les offres et les embeddings déjà en base, avec les fonctions de
`score.ts` telles qu'elles sont (`calibratedRange`, `rankOffers`, `evaluateOffer`), et dit en une
commande si le classement est sain. À lancer **après chaque déploiement** du matching.

- **Lecture seule** : la session PostgreSQL est ouverte avec `default_transaction_read_only=on`
  (vérifié avant toute lecture) ; toute écriture serait refusée par la base. Aucun appel au
  fournisseur d'IA : une offre pas encore embarquée est notée sans similarité (ligne « sans
  embedding »).
- **Aucune donnée identifiante** du candidat : ni nom, ni e-mail, ni employeur, ni texte de
  réalisation ou d'expérience, ni ses termes métier. Seulement son identifiant, les identifiants
  et empreintes courtes (8 caractères du SHA-256 du texte embarqué, celui de `memory_embeddings`)
  des éléments de sa mémoire, et des nombres. Les intitulés et entreprises des offres sont
  publics.

### Lancer l'audit

En local (`DATABASE_URL` du `.env`) :

```bash
npm run matching:audit -- <candidateId|email>
npm run --silent matching:audit -- <candidateId> --json > audit.json
```

Sur le VPS, dans le conteneur du worker (il a déjà `DATABASE_URL` et le code des scripts) :

```bash
docker compose exec worker npm run matching:audit -- <candidateId>
docker compose exec -T worker npm run --silent matching:audit -- <candidateId> --json > audit.json
```

Préférer l'identifiant à l'e-mail : la ligne de commande reste dans l'historique du shell.
L'identifiant d'un compte se trouve par exemple avec
`docker compose exec postgres psql -U coach coach_career -c "SELECT id FROM users WHERE email = '…'"`.

Options : `--json` (rapport JSON au lieu du texte), `--top N` (taille du top, 30 par défaut),
`--model M` (modèle d'embeddings ; par défaut celui des embeddings de la mémoire du candidat).
Les réglages (`MATCHING_SIM_FLOOR`, `MATCHING_SIM_CEIL`, `MATCHING_SIM_MIN_SAMPLES`,
`MATCHING_MIN_SCORE`, `MATCHING_MAX_PER_USER`) sont lus dans l'environnement, comme le worker.
Code de sortie : 0 rapport, 1 erreur, 2 candidat introuvable ou usage.

### Lire la sortie

1. **En-tête** : profil en nombres (réalisations prouvées, expériences, compétences, termes
   métier), réglages, puis le décompte des offres : ouvertes, pré-filtrées (SQL), dans les
   garde-fous (notées), sans embedding, retenues par le worker (score ≥ seuil, au plus `maxPerUser`).
2. **Mémoire** : une ligne par élément embarqué (réalisation prouvée ou déclarée, expérience) :
   empreinte, embedding présent (`emb.`), nombre d'offres comparées, médiane, p90, p99 et max de
   la similarité cosinus, et la **plage réellement utilisée** par le score : calibrée (médiane →
   0, p99 → 1) dès `MATCHING_SIM_MIN_SAMPLES` offres, sinon les bornes fixes de repli.
   - `emb. non` : la mémoire a changé depuis le dernier passage du worker (recalcul en attente).
   - un max loin au-dessus du p99 est sain (une offre se démarque) ; un p99 collé au max avec
     des centaines d'offres au-dessus signale une saturation (tout le haut vaut 1).
3. **Distribution des scores** des offres dans les garde-fous : min, quartiles, max et nombre
   ≥ 90, pour le score total et pour la composante `skills` (pertinence). `stockés` : les
   correspondances enregistrées par le dernier passage du worker (un écart avec `total` veut
   dire que le worker n'a pas encore recalculé avec le code déployé).
4. **Top N** : rang, score (`*` : entreprise suivie, bonus inclus), composantes (`ski`, `sen`,
   `sal`, `cul`), `gate` (part du contexte comptée, `min(1, pertinence / 0,5)`), `lex` (pertinence
   lexicale seule, sans embeddings), `app.lex` (au moins une compétence ou un intitulé du candidat
   trouvé dans l'offre), `exig.` (une exigence de l'offre est citée), `métier` (l'offre contient
   un terme métier du candidat), intitulé, entreprise, identifiant de l'offre et inconnus.
   La ligne d'en-tête du top donne la **part du top avec un terme métier**.

Signaux d'un classement malsain :

- beaucoup d'offres à `skills` ≥ 90 (des centaines) : la pertinence sature ;
- un top dominé par des offres `app.lex non` / `métier non`, ou une part du top avec un terme
  métier faible alors que des offres du métier existent plus bas ;
- `exig. non` partout : aucune exigence citée, l'explication ne s'appuie que sur la proximité ;
- `gate` à 1 sur des offres hors sujet : le salaire et la séniorité comptent en entier.

Le JSON (`--json`) contient les mêmes informations (`memory`, `scores`, `stored`, `top`,
`topBusinessTermShare`, …) pour comparer deux déploiements.

## Banc de profils de référence

`tests/unit/matching-bench.test.ts`, fixtures dans `tests/fixtures/matching/bench/` : quatre
profils types (technicien audiovisuel au profil mince — le cas du fondateur —, développeur senior
au profil riche, commercial B2B, reconversion aux compétences déclarées non prouvées), chacun avec
un jeu d'offres par famille (`metier`, `voisin`, `hors`), la distribution de chaque élément de la
mémoire (médiane, p99) et des similarités figées. Le test classe les offres comme le worker et
vérifie les attentes écrites dans chaque cas : offres du métier dans le top N, aucune offre hors
métier au-dessus d'un score, part du top avec un terme métier, écart signalé. Sans réseau ni base :
il tourne en CI avec `npm test`.

Une attente que le `score.ts` actuel ne tient pas est marquée `todo` avec l'issue du correctif
(le cas audiovisuel : #77), jamais supprimée. Après un changement du score, retirer le `todo`
d'un cas désormais tenu.
