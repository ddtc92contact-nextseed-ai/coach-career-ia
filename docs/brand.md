# Charte de marque — Coach Career IA (v2)

> v2 : coque de l'application avec menu latéral « nuit », fond teinté « brume », échelle de
> texte agrandie, composants `PageHeader` et `Card` (§4, §5, §6, §11). Pages hors application
> (accueil, connexion, espace entreprise, pages publiques) : §12.

> Source unique des couleurs, polices, ombres et animations : `src/app/globals.css`.
> Ce document explique les choix ; le code les applique. Toute nouvelle couleur passe
> d'abord par un jeton de `globals.css`, jamais par une valeur en dur dans un composant.

## 1. Positionnement

**En une phrase** : Coach Career IA est un agent de carrière privé qui travaille pour la
personne candidate, dans l'ombre, jusqu'à ce qu'elle donne son feu vert.

Ce qui nous distingue, dans l'ordre où on le raconte :

1. **Des preuves, pas des promesses** : la mémoire de carrière rassemble des réalisations
   chiffrées et vérifiables.
2. **Des garde-fous non négociables** : salaire plancher, télétravail, secteurs exclus.
3. **L'agent travaille, vous décidez** : radar, matching expliqué, contact anonyme,
   négociation dans un mandat ; chaque message est approuvé.
4. **La discrétion comme architecture** : coffre à connaissance nulle, cartes anonymes,
   hébergement en France / UE, IA européenne (Mistral AI).

### Ton de voix

| On est…                                     | On n'est pas…                                             |
| ------------------------------------------- | --------------------------------------------------------- |
| **Confiant** : des affirmations nettes      | Arrogant, superlatif (« révolutionnaire »)                |
| **Chaleureux** : on parle à une personne    | Familier, complice à l'excès                              |
| **Direct** : phrases courtes, verbes actifs | Jargonneux (« talents », « process RH », « soft skills ») |
| **Concret** : chiffres, exemples, preuves   | Vague (« boostez votre carrière »)                        |

Règles d'écriture :

- On dit « vous » en français (vouvoiement), et on suit le registre déjà établi dans
  chaque catalogue de traduction (`Sie` en allemand, `u` en néerlandais…).
- Une idée par phrase. Le verbe tôt.
- La personne reste sujet : « Vous validez chaque message », pas « Chaque message est
  validé ».
- Le français est écrit en premier (langue source), puis adapté — pas traduit mot à mot —
  dans les cinq autres langues. Les textes allemands et néerlandais sont plus longs : les
  mises en page laissent les titres passer à la ligne (`text-balance`, `hyphens-auto`).
- Typographie française : espaces insécables avant `: ; ? !`, guillemets « », apostrophe
  typographique `’` (obligatoire aussi dans les messages ICU, où `'` est un caractère
  d'échappement).

## 2. Logo

- **Nom** : « Coach Career IA » (inchangé, lu dans `metadata.siteName`).
- **Symbole** : un carré arrondi « nuit », un croissant d'ombre (l'agent qui travaille
  discrètement) et un point vert « signal » (le feu vert que vous donnez).
  Composant `BrandMark` (`src/components/logo.tsx`).
- **Logotype** : symbole + nom en Bricolage Grotesque gras, approche serrée
  (`tracking-tight`). Sur mobile, le nom passe en texte masqué et seul le symbole reste.
- **Favicon** : `src/app/icon.svg` (même dessin, couleurs en sRGB).
- **Image Open Graph** : `src/app/[locale]/opengraph-image.tsx`, générée par langue
  (symbole, nom, promesse du hero), sans police ni ressource externe.
- Zone de protection : la moitié de la hauteur du symbole tout autour. Ne pas déformer,
  recolorer ou ajouter d'ombre portée au symbole.

## 3. Couleurs

Toutes les couleurs sont des **rôles sémantiques** en oklch, redéfinis en thème sombre
(`prefers-color-scheme: dark`). Les utilitaires Tailwind portent le nom du rôle
(`bg-surface`, `text-ink-muted`, `border-line`…).

| Rôle                   | Utilitaires                                                                              | Clair                          | Sombre                        | Usage                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------ |
| canvas                 | `bg-canvas`                                                                              | brume `oklch(0.952 0.014 275)` | nuit `oklch(0.165 0.022 275)` | Fond de page (teinté : les cartes blanches s'en détachent)                     |
| surface                | `bg-surface`                                                                             | blanc                          | `oklch(0.21 0.027 275)`       | Cartes, champs                                                                 |
| subtle / muted         | `bg-subtle`, `bg-muted`                                                                  | 0.975 / 0.94 (teinte 275)      | 0.23 / 0.265                  | Zones secondaires dans une carte, survol                                       |
| line / line-strong     | `border-line`, `border-line-strong`                                                      | 0.9 / 0.8 (teinte 275)         | 0.31 / 0.42                   | Séparateurs, bordures de champ                                                 |
| ink                    | `text-ink`                                                                               | encre `oklch(0.22 0.035 275)`  | `oklch(0.96 0.008 85)`        | Texte principal                                                                |
| ink-muted / ink-subtle | `text-ink-muted`, `text-ink-subtle`                                                      | 0.42 / 0.52                    | 0.83 / 0.72                   | Texte secondaire, aides (AA ≥ 4,5:1 sur surface et canvas)                     |
| primary                | `bg-primary`, `text-on-primary`, `hover:bg-primary-hover`                                | nuit                           | papier                        | **Une** action principale par écran                                            |
| brand                  | `bg-brand`, `text-brand-ink`, `bg-brand-soft`, `border-brand-line`, `text-on-brand`      | vert `oklch(0.5 0.12 162)`     | `oklch(0.8 0.15 158)`         | Le « feu vert » : preuves, correspondances, liens, état actif de la navigation |
| signal                 | `bg-signal`, `text-signal`                                                               | `oklch(0.87 0.18 152)`         | idem                          | **Uniquement sur fond nuit** (hero, menu latéral, bandeaux nuit, appel final)  |
| night                  | `bg-night`, `bg-night-raised`, `border-night-line`, `text-on-night(-muted)`              | `oklch(0.2 0.045 275)`         | `oklch(0.12 0.03 275)`        | Les zones « dans l'ombre »                                                     |
| danger                 | `bg-danger`, `text-danger-ink`, `bg-danger-soft`, `border-danger-line`, `text-on-danger` | rouge 25°                      | rouge clair                   | Erreurs, actions destructrices                                                 |
| warning                | `bg-warning`, `text-warning-ink`, `bg-warning-soft`, `border-warning-line`               | ambre                          | ambre sombre                  | Avertissements                                                                 |
| success                | `text-success-ink`                                                                       | vert                           | vert clair                    | Confirmations                                                                  |
| info                   | `text-info-ink`, `bg-info-soft`, `border-info-line`                                      | bleu 250°                      | bleu clair                    | Statut « en vérification » (badge `info`)                                      |
| focus                  | `outline-focus`                                                                          | indigo `oklch(0.5 0.2 270)`    | vert clair                    | Anneau de focus clavier, toujours visible                                      |

Hors CSS (image Open Graph, favicon), les équivalents sRGB sont dans `src/config/brand.ts`
(nuit `#10142a`, ligne nuit `#353b57`, texte sur nuit `#f7f5f1`, signal `#66f597`).
Les e-mails transactionnels gardent leurs couleurs neutres en ligne (contrainte des
clients mail) et ne font pas partie de ce périmètre.

Contrastes vérifiés (Lighthouse : accessibilité 100 en clair et en sombre) : texte sur
fond ≥ 4,5:1, grands titres et icônes ≥ 3:1. v2 : `ink-subtle` sur le canvas brume 4,8:1,
`on-night-muted` sur nuit 9,7:1, `signal` sur nuit 13:1.

**Bandeaux de couleur** (utilitaires de `globals.css`) : `band-brand` (vert doux, halo
`brand`), `band-night` (nuit, halo `signal`) pour les en-têtes de page et les cartes mises en
avant ; `sidebar-night` pour le menu latéral. Un bloc sur fond nuit porte aussi la classe
`on-night` : l'anneau de focus y passe au vert `signal`.

## 4. Typographie

Deux familles, auto-hébergées par `next/font` (aucune requête vers Google au chargement
des pages ; sous-ensembles `latin` + `latin-ext`) :

- **Bricolage Grotesque** (`font-display`) : titres `h1`/`h2` (appliqué en base), logotype,
  chiffres mis en avant. Caractère chaleureux et affirmé.
- **Inter** (`font-sans`, défaut) : texte courant, interface, formulaires.

| Niveau        | Classe                                                           | Usage                          |
| ------------- | ---------------------------------------------------------------- | ------------------------------ |
| Display       | `text-4xl sm:text-5xl lg:text-[3.5rem] font-bold leading-[1.05]` | Titre du hero                  |
| H2 de section | `text-3xl sm:text-4xl font-bold tracking-tight`                  | Titres de section (accueil)    |
| Titre de page | `text-3xl sm:text-4xl font-bold tracking-tight`                  | `PageHeader` (h1)              |
| H2            | `font-display text-xl sm:text-2xl font-bold tracking-tight`      | `CardHeader`, sections de page |
| H3            | `text-lg font-semibold`                                          | Sous-parties d'une carte       |
| Chapô         | `text-base sm:text-lg text-ink-muted`                            | Sous le titre de page          |
| Corps         | `text-base` (16 px)                                              | Texte courant                  |
| Secondaire    | `text-sm` (15 px dans l'application)                             | Aides, métadonnées             |
| Menu latéral  | `text-[0.9375rem] font-medium` (15 px)                           | Entrées de navigation          |
| Surtitre      | `text-sm font-semibold uppercase tracking-wide text-brand-ink`   | Au-dessus des H2               |

**Échelle de l'application** : la coque `AppShell` applique l'utilitaire `type-app`, qui
redéfinit les variables Tailwind dans l'espace connecté : `text-sm` y vaut 15 px et `text-xs`
13 px (au lieu de 14 et 12 px sur le site public). Le corps reste à 16 px minimum ; aucun
texte de lecture ne descend sous `text-sm`.

Titres en `text-balance`, paragraphes en `text-pretty`.

## 5. Espacements, rayons, ombres

- **Espacement** : échelle Tailwind (4 px). Sections de l'accueil : `py-20 sm:py-28` ;
  cartes : `p-5 sm:p-7` ; conteneur du site public : `max-w-6xl px-4 sm:px-6` (16 px de
  gouttière sur mobile) ; contenu de l'application : toute la largeur à côté du menu, au plus
  `max-w-[80rem]` (1280 px), `px-4 sm:px-8 lg:px-10`, `py-8 lg:py-10`.
- **Rayons** : champs et boutons `rounded-lg` ; cartes `rounded-2xl` ; grands panneaux
  (hero, tarifs, appel final) `rounded-3xl` ; pastilles `rounded-full`.
- **Ombres** (`--shadow-*`, teintées nuit, plus profondes en sombre) : `shadow-xs`
  (champs, boutons secondaires), `shadow-sm` (cartes), `shadow-md` (survol, panneaux),
  `shadow-lg` (visuel du hero, offre mise en avant).

## 6. Composants partagés

- **Boutons** : `buttonClass(variant, size)` (`src/components/button.ts`) — `primary`,
  `secondary`, `ghost`, `signal` (sur fond nuit) ; tailles `sm`, `md`, `lg`.
- **Champs** : `inputClass` (`src/components/form.tsx`) — bordure `line-strong`, focus
  vert avec halo.
- **Badges** : `Badge` — tons `neutral`, `proven`, `warning`, `info`, `danger` ; `dot` ajoute
  une pastille de couleur (le libellé reste porteur du sens) ; tailles `sm` et `md` (statuts).
- **Coque de l'application** : `AppShell` (`src/components/shell/app-shell.tsx`), partagée
  par l'espace candidat et l'espace entreprise — voir §11.
- **En-tête de page** : `PageHeader` (`src/components/page-header.tsx`) — `title` (h1),
  `lead`, `eyebrow`, `actions`, et `band="brand" | "night"` pour un bandeau de couleur.
  Un par page ; l'ancienne API `PageTitle` (`empty-state.tsx`) le réutilise sans bandeau.
  Le bandeau sert aux pages d'accueil d'un espace (tableau de bord) et aux pages « héros »
  d'une fonctionnalité ; les écrans de formulaire gardent un en-tête simple.
- **Cartes** : `Card` (`src/components/card.tsx`) — `tone="default" | "brand" | "night"`,
  `as="section" | "div" | "article" | "aside"` ; `CardHeader` (titre h2 ou h3, description,
  actions). Fond de page teinté + cartes blanches : jamais de blanc sur blanc.
- **En-tête / pied de page du site** : `SiteHeader` (ancres de section sur l'accueil),
  `SiteFooter` (symbole, promesse, liens légaux ; aussi sous le contenu de l'application).

## 7. Iconographie

`src/components/icons.tsx` : trait de 1,75 sur une grille de 24, extrémités et angles
arrondis, couleur héritée du texte (`currentColor`). Toujours accompagnées de texte (visible
ou masqué en mode rail) et marquées `aria-hidden`. Chaque entrée du menu a son icône. Pas de bibliothèque d'icônes externe ; une nouvelle icône suit la
même grille.

## 8. Illustration

Pas de photos de stock ni d'illustrations de personnages. On **montre le produit**, en
code : panneaux « nuit » qui reproduisent l'interface de l'agent (offre repérée, garde-fous
cochés, score de correspondance, brouillon en attente d'accord), conversations du coach.
Les données de démonstration sont réalistes et chiffrées, jamais nominatives.
Décor : halos radiaux très doux (vert `brand-soft` sur fond clair, `signal` sur fond nuit).

## 9. Mouvement

- **Sens** : le mouvement raconte le travail de l'agent (il cherche, vérifie, rédige,
  attend). Rien ne bouge pour décorer.
- **Courbe** : `cubic-bezier(0.22, 1, 0.36, 1)` (`--ease-out-soft`), durées de 150 à
  300 ms pour les micro-interactions.
- **Apparition au défilement** : classe `.reveal`, en CSS pur (`animation-timeline: view()`),
  sans JavaScript ; là où le navigateur ne la gère pas, le contenu s'affiche simplement.
- **Visuel du hero** : boucle CSS de 16 s (`hero-demo.module.css`).
- **Menu latéral** : glissement du tiroir et réduction en rail en 300 ms
  (`ease-out-soft`, `motion-safe:`) ; sans animation en mouvement réduit.
- **Accessibilité** : toutes les animations sont déclarées sous
  `@media (prefers-reduced-motion: no-preference)` ou `motion-safe:` ; en mouvement
  réduit, l'état final s'affiche immobile.

## 10. Thèmes clair et sombre

Le thème suit le réglage du système. Les deux sont conçus comme des thèmes à part entière :
en sombre, l'action principale devient « papier » sur nuit et le vert passe à une teinte
plus lumineuse. `color-scheme: light dark` adapte les contrôles natifs (listes, cases).

## 11. Coque de l'application (navigation)

Espace candidat (`/app/**`) et espace entreprise (`/entreprise/**`) partagent `AppShell` :

- **Menu latéral à gauche**, fond `sidebar-night` (l'agent qui travaille « dans l'ombre »),
  textes `on-night`. Entrées groupées en sections titrées (`app.nav.groups.*`,
  `employer.nav.groups.*`) : _Mon profil_, _Mon agent_, _Compte_, _Administration_ (admins
  seulement) côté candidat ; _Recrutement_, _Compte_ côté entreprise. Catalogues :
  `APP_NAV` / `ADMIN_NAV` (`src/app/[locale]/app/nav.tsx`) et `EMPLOYER_NAV`.
- **Entrée** : icône + libellé 15 px, zone cliquable ≥ 44 px, coins `rounded-xl`. Survol :
  `bg-night-raised`. **Active** : `aria-current="page"`, fond `night-raised` + anneau
  `night-line`, barre verticale et icône `signal`. Règle d'activation : `isNavActive`
  (`src/components/shell/nav.ts`).
- **Pastille** de nouveautés (réponses non lues, messages non ouverts) : `bg-signal
text-night`, avec un libellé pour les lecteurs d'écran ; point sur l'icône en mode rail.
- **Bas du menu** : état du coffre, lien vers l'autre espace (membres d'une organisation
  seulement), langue, compte (initiale + e-mail) et déconnexion. Côté entreprise, le nom de
  l'organisation et son statut s'affichent sous le logo.
- **Bureau (≥ 1024 px)** : colonne fixe de 272 px, réductible en rail d'icônes de 80 px
  (libellés en infobulle et lus par les lecteurs d'écran). Le choix est mémorisé dans le
  cookie `cc-sidebar` (un an, strictement nécessaire, listé dans la politique cookies).
- **Téléphone et tablette** : barre du haut « nuit » (logo + bouton menu) ; le menu s'ouvre
  en tiroir modal (`role="dialog"`) : focus piégé, Échap et clic sur le voile ferment,
  fermeture à la navigation, défilement de la page bloqué, reste de la page `inert`.
- Lien d'évitement « Aller au contenu » en premier élément focalisable.

## 12. Pages hors application (v2)

- **Accueil** : corps de texte à 18 px (`text-lg` sur `<main>`), titres de section
  `text-4xl sm:text-5xl`, hero jusqu'à 64 px. Les sections alternent des bandeaux
  (`Section band="canvas" | "surface" | "brand" | "night"`) : jamais deux fonds blancs de
  suite — brume, vert doux, nuit, brume, blanc, vert doux, brume, nuit, pied de page.
- **En-tête du site** (`SiteHeader`) : ancres de section visibles dès 1024 px (`SectionNav`),
  section lue mise en avant (pastille `brand-soft` + trait, `aria-current`). Sous 1024 px,
  bouton menu et panneau plein écran « nuit » (`SiteMenu`, `role="dialog"`) : focus piégé,
  Échap, fermeture au clic sur un lien, défilement bloqué, reste de la page `inert`.
- **Connexion, inscription** (`AuthCard`) : sur bureau, formulaire à gauche et panneau
  `band-night` de la promesse à droite (candidat, ou entreprise si `callbackUrl` mène à
  `/entreprise`) ; sur téléphone, formulaire seul en pleine largeur. Champs et boutons
  agrandis (`inputClassLg`, `PasswordField size="lg"`, `buttonClass(…, "lg")`).
  `panel={false}` : carte centrée (404, désabonnement).
- **Espace entreprise** : statut d'offre en badge coloré avec pastille — brouillon (neutre),
  paiement (ambre), vérification (bleu `info`), en ligne (vert), fermée (neutre), expirée et
  refusée (rouge) — et frise des étapes de publication.
- **Pages à jeton** (`PublicFrame`) : barre du haut, colonne de 768 px, texte à 17 px, note de
  confidentialité ; aucune donnée ajoutée à ce que la page affichait déjà.
- **Pages légales** : bandeau vert doux, sommaire collant, colonne de lecture `max-w-[70ch]`
  en 17–18 px, interligne 1,7.
