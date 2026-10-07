# Fixtures du Market Radar

Réponses JSON utilisées par les tests : aucun test n'appelle le réseau.

- `greenhouse-dataiku.json`, `lever-qonto.json`, `ashby-alan.json` : réponses réelles des
  endpoints publics (enregistrées le 2026-10-07), réduites à 3 offres et descriptions
  tronquées.
- `lever-salary.json` : offre Lever construite selon la documentation de l'API publique,
  pour couvrir `salaryRange` (absent des boards enregistrés).
- `france-travail-*.json` : construites selon la documentation de l'API « Offres d'emploi v2 »
  (pas d'identifiants partenaire au moment de l'enregistrement). Données fictives ; le bloc
  `contact` est présent pour vérifier qu'il n'est jamais stocké.
