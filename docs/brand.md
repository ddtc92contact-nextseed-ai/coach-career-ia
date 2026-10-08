# Charte de marque — Coach Career IA

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

| Rôle                   | Utilitaires                                                                              | Clair                                | Sombre                        | Usage                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------- |
| canvas                 | `bg-canvas`                                                                              | papier chaud `oklch(0.985 0.005 85)` | nuit `oklch(0.165 0.022 275)` | Fond de page                                                                        |
| surface                | `bg-surface`                                                                             | blanc                                | `oklch(0.205 0.026 275)`      | Cartes, champs                                                                      |
| subtle / muted         | `bg-subtle`, `bg-muted`                                                                  | 0.972 / 0.948                        | 0.23 / 0.265                  | Zones secondaires, survol                                                           |
| line / line-strong     | `border-line`, `border-line-strong`                                                      | 0.912 / 0.83                         | 0.31 / 0.42                   | Séparateurs, bordures de champ                                                      |
| ink                    | `text-ink`                                                                               | encre `oklch(0.22 0.035 275)`        | `oklch(0.96 0.008 85)`        | Texte principal                                                                     |
| ink-muted / ink-subtle | `text-ink-muted`, `text-ink-subtle`                                                      | 0.42 / 0.52                          | 0.83 / 0.72                   | Texte secondaire, aides (AA ≥ 4,5:1 sur surface et canvas)                          |
| primary                | `bg-primary`, `text-on-primary`, `hover:bg-primary-hover`                                | nuit                                 | papier                        | **Une** action principale par écran                                                 |
| brand                  | `bg-brand`, `text-brand-ink`, `bg-brand-soft`, `border-brand-line`, `text-on-brand`      | vert `oklch(0.5 0.12 162)`           | `oklch(0.8 0.15 158)`         | Le « feu vert » : preuves, correspondances, liens, état actif de la navigation      |
| signal                 | `bg-signal`, `text-signal`                                                               | `oklch(0.87 0.18 152)`               | idem                          | **Uniquement sur fond nuit** (visuel du hero, section confidentialité, appel final) |
| night                  | `bg-night`, `bg-night-raised`, `border-night-line`, `text-on-night(-muted)`              | `oklch(0.2 0.045 275)`               | `oklch(0.12 0.03 275)`        | Les zones « dans l'ombre »                                                          |
| danger                 | `bg-danger`, `text-danger-ink`, `bg-danger-soft`, `border-danger-line`, `text-on-danger` | rouge 25°                            | rouge clair                   | Erreurs, actions destructrices                                                      |
| warning                | `text-warning-ink`, `bg-warning-soft`, `border-warning-line`                             | ambre                                | ambre sombre                  | Avertissements                                                                      |
| success                | `text-success-ink`                                                                       | vert                                 | vert clair                    | Confirmations                                                                       |
| focus                  | `outline-focus`                                                                          | indigo `oklch(0.5 0.2 270)`          | vert clair                    | Anneau de focus clavier, toujours visible                                           |

Hors CSS (image Open Graph, favicon), les équivalents sRGB sont dans `src/config/brand.ts`
(nuit `#10142a`, ligne nuit `#353b57`, texte sur nuit `#f7f5f1`, signal `#66f597`).
Les e-mails transactionnels gardent leurs couleurs neutres en ligne (contrainte des
clients mail) et ne font pas partie de ce périmètre.

Contrastes vérifiés (Lighthouse : accessibilité 100 en clair et en sombre) : texte sur
fond ≥ 4,5:1, grands titres et icônes ≥ 3:1.

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
| Titre de page | `text-2xl sm:text-3xl font-bold`                                 | `PageTitle` dans l'application |
| H3            | `text-lg font-semibold`                                          | Cartes                         |
| Corps large   | `text-lg`                                                        | Introductions                  |
| Corps         | `text-base` / `text-sm`                                          | Texte, interface               |
| Surtitre      | `text-sm font-semibold uppercase tracking-wide text-brand-ink`   | Au-dessus des H2               |

Titres en `text-balance`, paragraphes en `text-pretty`.

## 5. Espacements, rayons, ombres

- **Espacement** : échelle Tailwind (4 px). Sections de l'accueil : `py-20 sm:py-28` ;
  cartes : `p-6 sm:p-8` ; conteneur : `max-w-6xl px-4 sm:px-6` (16 px de gouttière sur
  mobile).
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
- **Badges** : `Badge` (`neutral`, `proven`, `warning`).
- **Navigation** : onglet actif souligné en vert `brand`.
- **En-tête / pied de page** : `SiteHeader` (ancres de section sur l'accueil),
  `SiteFooter` (symbole, promesse, liens légaux).

## 7. Iconographie

`src/components/icons.tsx` : trait de 1,75 sur une grille de 24, extrémités et angles
arrondis, couleur héritée du texte (`currentColor`). Toujours accompagnées de texte et
marquées `aria-hidden`. Pas de bibliothèque d'icônes externe ; une nouvelle icône suit la
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
- **Accessibilité** : toutes les animations sont déclarées sous
  `@media (prefers-reduced-motion: no-preference)` ou `motion-safe:` ; en mouvement
  réduit, l'état final s'affiche immobile.

## 10. Thèmes clair et sombre

Le thème suit le réglage du système. Les deux sont conçus comme des thèmes à part entière :
en sombre, l'action principale devient « papier » sur nuit et le vert passe à une teinte
plus lumineuse. `color-scheme: light dark` adapte les contrôles natifs (listes, cases).
