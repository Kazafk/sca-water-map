# SCA Water Map — Extension Monde

**Date :** 2026-06-25  
**Statut :** approuvé  
**Périmètre :** remplacement de la carte France par une carte monde avec drill-down commune France

---

## Contexte

La SCA Water Map affiche actuellement la qualité de l'eau du robinet pour 34 500 communes françaises, évaluées selon les standards SCA (Specialty Coffee Association). Le projet dispose de données de composition d'eau pour ~74 500 villes dans ~70 pays (dossier `C:\Repos\tap-water-db`), sans coordonnées géographiques. L'objectif est d'étendre la carte au niveau mondial tout en conservant le drill-down commune France existant.

---

## Architecture cible

### Vue d'ensemble

`index.html` devient la carte monde. La logique cartographique passe de `map.js` à `world-map.js`. Trois niveaux de zoom coexistent dans une seule carte MapLibre :

| Zoom | Couche | Données |
|------|--------|---------|
| 0–4 | Choroplèthe pays | `world-countries.json` + Natural Earth GeoJSON |
| 4–7 | Marqueurs villes | `world-cities.json` |
| 7+ | Polygones communes | GeoJSON France (chargé à la demande) |

---

## Pipeline de données

### Script `data/build_world.py`

Exécution one-shot. Produit deux fichiers statiques committés dans `public/`.

**Entrées :**
- 27 fichiers JSON dans `C:\Repos\tap-water-db\` (tous sauf `france_water_quality.json`)
- `data/geonames/cities500.txt` — base GeoNames téléchargée localement (gitignorée, ~50 MB)

**Étapes :**

1. **Lecture et normalisation**
   - Extraction du pays depuis le suffixe `"CityName (Country)"`, ou depuis le nom du fichier pour les entrées sans suffixe
   - Déduplication par `(nom normalisé, pays)` — on garde l'entrée avec le plus de paramètres non-nuls
   - Plages `"17.0 - 25.0"` → midpoint

2. **Géocodage offline (GeoNames)**
   - Matching par nom de ville + pays après normalisation (accents, casse, ponctuation)
   - Entrées non géocodables → loguées dans `data/geocoding_misses.csv`, ignorées du JSON final
   - Estimation : ~80–90 % de couverture

3. **Conversion d'unités**
   - `Ca_Hardness_dH × 17.848` → `ca_hardness` (mg/L CaCO3)
   - `Alkalinity_TAC_mmol_l × 50` → `alkalinity` (mg/L CaCO3)
   - pH, TDS, Na, Cl : unités déjà compatibles

4. **Calcul des scores SCA**
   - Même logique que `scoring.js`, portée en Python
   - Score primaire : distance Ca Hardness / Alkalinity au centre SCA (68 / 55 mg/L CaCO3)
   - Score secondaire : pH, TDS, Na, Cl (pondération 20 %)
   - Score null si Ca Hardness ET Alkalinity absents

5. **Agrégation pays**
   - Moyenne des scores non-nuls par pays
   - Comptage des villes scorées vs total

**Sorties :**

`public/world-cities.json`
```json
[
  {
    "id": "berlin-DE",
    "name": "Berlin",
    "country": "DE",
    "country_name": "Germany",
    "lat": 52.52,
    "lng": 13.405,
    "score": 0.82,
    "params": {
      "ca_hardness": 142.0,
      "alkalinity": 210.0,
      "ph": 7.4,
      "tds": 550,
      "na": 18.0,
      "cl": 42.0
    }
  }
]
```

`public/world-countries.json`
```json
[
  {
    "iso2": "DE",
    "name": "Germany",
    "avg_score": 0.41,
    "city_count": 287,
    "scored_count": 241
  }
]
```

---

## Rendu cartographique (`world-map.js`)

### Couches MapLibre

**Niveau pays (zoom 0–4)**
- Source : Natural Earth countries GeoJSON (110m, ~500 KB, chargé au démarrage)
- Layer `countries-fill` : `fill-color` depuis `avg_score`, opacité interpolée (1 à zoom 4, 0 à zoom 5)
- Layer `countries-line` : bordures fines
- Layer `countries-labels` : nom pays visible dès zoom 1

**Niveau villes (zoom 4–7)**
- Source : `world-cities.json` (~40 K points)
- Layer `cities-circle` : cercles colorés par score, rayon interpolé selon zoom
- Layer `cities-labels` : nom ville visible dès zoom 5
- Apparition progressive : opacité 0 à zoom 3, 1 à zoom 5

**Niveau communes France (zoom 7+)**
- GeoJSON France chargé à la demande au premier zoom ≥ 7 ET center dans bbox France `[-5.5, 41.0, 10.0, 51.5]`
- Layers `communes-fill`, `communes-line`, `communes-selected`, `communes-labels` identiques à l'existant
- GeoJSON resté en mémoire après premier chargement

### Palette de couleurs (inchangée)

| Score | Label | Couleur |
|-------|-------|---------|
| ≥ 0.75 | Idéal SCA | `#2ecc71` |
| ≥ 0.50 | Acceptable | `#3498db` |
| ≥ 0.25 | Hors plage | `#f39c12` |
| < 0.25 | Très hors SCA | `#e74c3c` |
| null | Données insuffisantes | `#2d2d2d` |

---

## Interactions et UX

### Clic pays
- Panel "Vue pays" : nom du pays, score moyen, jauge colorée, top 5 villes par score, comptage
- Clic sur France → flyTo bbox France + zoom 7 + chargement GeoJSON communes

### Clic ville (marqueur)
- Panel "Vue ville" : nom, pays, score, tableau des 7 paramètres avec barres SCA (min/idéal/max)
- Pas d'onglet Hub'Eau (données non disponibles hors France)

### Clic commune (polygone France)
- Panel commune existant (`panel.js`) — comportement intégralement préservé
- Onglets params / data / compare inchangés

### Dezoom depuis France
- Commune désélectionnée si zoom passe sous 7
- Retour au panel vide monde

### Recherche
- Priorité 1 : world-cities (matching sur `name` + `country_name`)
- Priorité 2 : communes France (`communesData`)
- Dropdown mélangé avec badge pays : `"Berlin 🇩🇪"` vs `"Berlin (57) 🇫🇷"`
- Sélection ville monde → flyTo lat/lng + zoom 6 + panel ville
- Sélection commune → flyTo centre commune + zoom 12 + panel commune

### URL state
- `?country=DE` → centre + zoom pays, panel pays
- `?city=berlin-DE` → centre + zoom ville, panel ville
- `?commune=75056` → drill-down commune France (comportement existant préservé)

### Bouton maison
- flyTo `[10, 20]`, zoom `2`

---

## Structure des fichiers

**Nouveaux fichiers :**
```
data/
  build_world.py
  geonames/               ← gitignored
  geocoding_misses.csv    ← gitignored

public/
  world-cities.json
  world-countries.json
  world-map.js       ← logique carte (zoom, layers, interactions, search, URL state)
  world-panel.js     ← rendu HTML panel ville + panel pays (équivalent de panel.js pour le monde)
```

**Fichiers modifiés :**
```
public/
  index.html    ← centre monde, importe world-map.js
  style.css     ← styles panel ville/pays
```

**Fichiers inchangés :**
```
public/
  communes.json
  scoring.js
  panel.js
  sheet.js
  bottled.html / bottled.js
  about.html
```

---

## Gestion des cas limites

| Cas | Comportement |
|-----|-------------|
| Ville non géocodée | Absente de world-cities.json, loguée dans geocoding_misses.csv |
| Score null (params insuffisants) | Ville gardée, affichée en gris, non comptée dans moyenne pays |
| Pays sans ville scorable | Polygone gris, panel "Données insuffisantes" |
| GeoJSON France non encore chargé | Spinner de chargement, layers communes masquées pendant le fetch |
| Dezoom hors France | Commune désélectionnée, panel vide monde |

---

## Ce qui est hors périmètre

- Mise à jour automatique des données monde (GitHub Actions) — statique pour l'instant
- Géolocalisation monde (bouton locate reste France-only)
- Mode département pour les pays étrangers
- Mode comparaison entre villes mondiales
- Page eaux en bouteille — inchangée
