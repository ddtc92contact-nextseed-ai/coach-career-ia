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
- `recruitee-matera.json`, `workable-exotec.json` : réponses réelles (2026-10-07) de
  `matera.recruitee.com/api/offers/` et du widget Workable d'Exotec, réduites à 6 offres
  (descriptions tronquées ; pour Workable, la ligne « salaire » éventuelle est conservée).
  Couvrent salaire structuré et incohérent (« 40.00 – 45000 »), télétravail, contrats.
- `smartrecruiters-nexity-*.json` : réponses réelles (2026-10-07, enregistrées à la main,
  `limit=3`) de la Posting API pour Nexity ; `totalFound` ramené à 5 pour tester la
  pagination sur deux pages. `-postings.json` regroupe les annonces détaillées par `id`
  (textes tronqués) ; une ligne « Rémunération : 48 000 € – 55 000 € » a été ajoutée à
  l'annonce `744000152202129` pour couvrir la lecture d'un salaire dans le texte.
- `france-travail-ats-v2.json` : offres France Travail fictives qui doublonnent des offres
  Recruitee, Workable (URL partenaire) et SmartRecruiters.
- `companies-v2.json` : configuration avec les nouveaux ATS et une entreprise inactive.
