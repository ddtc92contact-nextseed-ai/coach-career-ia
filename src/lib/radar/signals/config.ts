/**
 * Seuils des signaux faibles d'entreprise (Market Radar). Tous les réglages
 * de détection sont ici, et seulement ici : les ajuster ne demande pas de
 * toucher au calcul (`./compute.ts`).
 *
 * Unités : semaines (lundi 00:00 UTC → lundi suivant), nombres d'offres,
 * parts entre 0 et 1.
 */
export const SIGNAL_THRESHOLDS = {
  /** Semaines (terminées) recalculées à chaque passage du job. */
  lookbackWeeks: 8,

  /** Historique minimal pour émettre le moindre signal (sinon : du bruit). */
  minHistoryWeeks: 4,
  minOffers: 3,

  /**
   * Semaines précédentes servant de référence (moyenne propre à l'entreprise).
   * La semaine de la première collecte est exclue : toutes les offres déjà en
   * ligne y apparaissent « nouvelles ».
   */
  baselineWeeks: 8,

  surge: {
    /** Nouvelles offres au moins `newRatio` × la moyenne de référence… */
    newRatio: 2.5,
    /** …et au moins ce nombre. */
    minNew: 4,
    /** Ou : offres ouvertes au moins `openRatio` × la moyenne de référence… */
    openRatio: 1.5,
    /** …avec au moins ce nombre d'offres ouvertes en plus. */
    minOpenIncrease: 5,
    /** Ratio à partir duquel le signal est « fort » / « moyen ». */
    strongRatio: 5,
    mediumRatio: 3.5,
  },

  freeze: {
    /** Semaines consécutives (jusqu'à la semaine examinée) sans nouvelle offre. */
    quietWeeks: 2,
    /** Fermetures minimales sur ces semaines… */
    minClosed: 3,
    /** …représentant au moins cette part des offres ouvertes au début. */
    minClosedShare: 0.5,
    /** L'entreprise recrutait : moyenne de référence de nouvelles offres. */
    minBaselineNew: 1,
  },

  novelty: {
    /** Offres déjà vues avant la semaine pour juger qu'une famille / un lieu est « nouveau ». */
    minPriorOffers: 5,
  },

  repost: {
    /** Offre de même clé de déduplication republiée au plus tant de jours après sa fermeture. */
    maxGapDays: 120,
  },

  remoteShift: {
    /** Fenêtre récente (semaines, incluant la semaine examinée) comparée à la référence. */
    recentWeeks: 4,
    /** Offres (télétravail précisé) minimales dans chacune des deux périodes. */
    minSample: 4,
    /** Écart minimal de part d'offres hybrides / à distance. */
    minDelta: 0.3,
  },

  /** Signaux affichés sur une offre : semaines récentes et nombre maximal. */
  display: {
    recentWeeks: 12,
    maxPerOffer: 3,
  },
} as const;

export type SignalThresholds = typeof SIGNAL_THRESHOLDS;
