# Fixtures du géocodage

Réponses JSON utilisées par les tests : aucun test n'appelle le réseau.

- `ban-*.json` : construites selon le format documenté du géocodeur de la Base Adresse
  Nationale (Géoplateforme IGN, `data.geopf.fr/geocodage/search`, GeoJSON
  `FeatureCollection`) ; coordonnées réelles des communes, champs réduits.
- `nominatim-berlin.json` : construite selon le format `jsonv2` documenté de Nominatim
  (`addressdetails=1`). Données © les contributeurs d'OpenStreetMap, ODbL.
