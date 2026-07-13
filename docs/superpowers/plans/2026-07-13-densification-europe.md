# Plan de densification des données — Europe

**Objectif :** amener chaque pays européen vers une densité de mesures comparable à la France (couverture communale via Hub'Eau), en combinant importeurs nationaux (données) et contours administratifs (affichage).

**Date :** 2026-07-13
**Référence :** la France = ~35 000 communes scorées via l'API Hub'Eau. Aucun autre pays n'offre un équivalent unique ; la densification passe par des sources nationales hétérogènes, sur le modèle de `data/build_california.py` (sortie au format tap-water-db dans `data/world/`, ingérée automatiquement par `build_world.py`).

---

## 1. État des lieux (2026-07-13)

Villes scorées dans `world-cities.json` / polygones affichés dans `eu-places.json` :

### Pays bien couverts (aucune action)
AT 1786/1726 · CH 1343/1225 · PL 566/561 · FI 299/290 · SE 258/247 · HU 196/195 · CZ 193/192 · NO 186/160 · RO 105/105 · HR 97/92 · DK 68/67 · SI 60/53 · RS 60/45 · GR 48/34 · LV 48/45 · LT 48/38 · EE 47/42 · AL 39/31 · BG 36/34 · SK 22/21 · IE 20/19 · LU 18/17 · MK 17/17 · IS 16/15 · MT 10/9 · CY 9/5 · LI 8/7

### Trou de DONNÉES (placeholders synthétiques dans tap-water-db, quasi zéro ville réelle)
| Pays | Villes | Population | Cause |
|------|--------|-----------|-------|
| DE | 3 | 84 M | fichier source = « Deutsche Gemeinde N » (synthétique) |
| IT | 3 | 59 M | « Comune N » |
| ES | 3 | 48 M | « Municipio N » |
| GB | 3 | 68 M | 3 compagnies seulement (Thames, Severn Trent, Scottish) |
| PT | 3 | 10 M | « Concelho N » |
| NL | 2 | 18 M | « Gemeente N » |
| BE | 1 | 12 M | « Commune belge N » |

### Trou de CONTOURS (villes scorées mais hors couverture GISCO LAU 2021)
| Pays | Villes scorées | Polygones | Source de contours proposée |
|------|---------------|-----------|------------------------------|
| UA | **463** | 0 | geoBoundaries ADM3 (hromadas) |
| MD | 45 | 0 | geoBoundaries ADM1/ADM2 |
| BA | 28 | 0 | geoBoundaries ADM2/ADM3 (općine) |
| ME | 17 | 0 | geoBoundaries ADM1 |
| XK | 14 | 0 | geoBoundaries ADM1/ADM2 |
| BY | 10 | 0 | geoBoundaries ADM2 |
| GB | 3 | 0 | **LAU 2021 exclut le UK (post-Brexit)** → ONS Open Geography (LAD/BUA, licence OGL) |
| AD / SM | 4 / 4 | 0 | geoBoundaries ADM1 |

---

## 2. Architecture commune des importeurs

Pattern éprouvé par `build_california.py` :

```
data/build_<pays>.py
  → télécharge/scrape la source nationale (cache dans data/<pays>/, gitignoré)
  → convertit les unités vers le format tap-water-db :
      Ca_Hardness_dH        = mg/L CaCO3 ÷ 17.848   (ou °f ÷ 1.7848)
      Alkalinity_TAC_mmol_l = mg/L CaCO3 ÷ 50
  → agrège par ville (médiane par réseau, moyenne pondérée population)
  → écrit data/world/<pays>_water_quality.json
      format { "Ville (Pays)": { Parameters: {...} } }
```

Puis chaîne de reconstruction (JAMAIS relancer le pipeline France `compute_scores.py`) :

```
python data/build_world.py        # ré-agrège world-cities.json + world-countries.json
python data/build_eu_places.py    # re-matche les nouvelles villes aux polygones LAU
```

Les polygones LAU sont **déjà téléchargés et couvrent DE/IT/ES/PT/NL/BE** : dès qu'un importeur ajoute des villes, `build_eu_places.py` leur associe automatiquement un contour. Seuls UK et les pays hors LAU nécessitent un script de contours dédié.

Paramètres SCA cibles par ville (idéalement ≥ 4 pour éviter le badge « Données partielles ») : dureté calcique, TAC/alcalinité, pH, TDS/conductivité, sodium, chlorure.

---

## 3. Plan pays par pays

### Phase 1 — Gains rapides (effort faible, gros impact visuel)

#### 1a. Ukraine + pays hors LAU : contours geoBoundaries — `data/build_extra_places.py`
- **Données : déjà présentes** (463 villes UA scorées invisibles au zoom > 4 !)
- Source : geoBoundaries (geoboundaries.org, licence ouverte, GeoJSON par pays/niveau)
- Script générique paramétré `{iso2: (iso3, adm_level)}` couvrant UA (ADM3), MD, BA, ME, XK, BY, AD, SM — même matching spatial PIP que `build_eu_places.py`, sortie fusionnée dans `eu-places.json` (ou `extra-places.json` séparé)
- **Bonus** : le même script servira plus tard hors Europe (CN 283, RU 194, CA 187, BR 149…)
- Effort : ~½ journée. Rendement : ~580 polygones d'un coup.

#### 1b. Belgique — `data/build_belgium.py`
- **Wallonie** : open data ODWB `zones-de-distribution-en-eau-wallonie` (odwb.be) + fiches par zone de l'outil cartographique SPW (environnement.wallonie.be) — vraie donnée publique structurée
- **Flandre** : De Watergroep (recherche dureté/qualité par gemeente), water-link (Anvers), Farys, Pidpa — pages structurées par commune
- **Bruxelles** : Vivaqua publie la composition de l'eau par commune (19 communes)
- Rendement attendu : 300–580 communes. Polygones LAU déjà prêts. Effort : 1–2 jours.

### Phase 2 — Importeurs à fort rendement (sources structurées)

#### 2a. Pays-Bas — `data/build_netherlands.py`
- La base nationale REWAB (RIVM) n'est **pas** en open data (accès soumis à Vewin)
- Voie libre : les **10 compagnies** couvrent 100 % du territoire et publient leurs analyses par station/commune : Vitens, PWN, Waternet, Evides, Dunea, Brabant Water, WML, WMD, Waterbedrijf Groningen (+ lookup dureté par code postal chez la plupart)
- Rendement : ~342 gemeenten possibles. Effort : 2–3 jours (10 sites, formats majoritairement structurés).

#### 2b. Royaume-Uni — `data/build_uk.py` + contours ONS
- **Données** : les 22 compagnies publient un lookup qualité par postcode + rapports annuels par supply zone (Severn Trent « check my water quality », Anglian supply-zone map, Thames >100 zones à Londres…) ; le DWI publie les retours annuels par compagnie. Stratégie : interroger les lookups par postcode des ~200 principales villes, ou parser les CSV/PDF de zones
- **Contours** : LAU exclut le UK → ONS Open Geography Portal (Local Authority Districts ou Built Up Areas, licence OGL) via un `build_uk_places.py` clone du pattern spatial
- Rendement : 100–300 villes. Effort : 3–5 jours (hétérogénéité des 22 compagnies).

#### 2c. Allemagne — `data/build_germany.py`
- **Amorce rapide** : liste Wikipedia « Trinkwasserversorgung deutscher Großstädte » (80 villes > 100 000 hab : Härtebereich, nitrate) — partiel mais immédiat
- **Cœur** : scraping des pages « Trinkwasseranalyse » des Stadtwerke (obligation légale de publication ; analyses complètes Ca, Mg, Na, Cl, pH, Säurekapazität→TAC, conductivité). Cible : top 100–200 villes. trinkwasserdatenbank.de (gratuit) en complément nitrate/dureté
- **Option payante** : leitungswasserqualitaet.de (~200 000 relevés, API JSON sous licence) si le scraping s'avère trop coûteux
- Rendement : 80 villes (amorce) → 500+ (scraping). Effort : 1 jour (amorce) + 3–5 jours (Stadtwerke, formats hétérogènes).

### Phase 3 — Scraping lourd (sources fragmentées par gestionnaire)

#### 3a. Italie — `data/build_italy.py`
- Pas d'open data national ; chaque gestore publie une « etichetta dell'acqua » par comune, souvent en pages web structurées : **Hera** (~230 comuni, Émilie-Romagne), **Gruppo CAP** (~190, métropole de Milan), **Acea ATO2** (Rome + Latium), SMAT (Turin), Acquedotto Pugliese (Pouilles), Abbanoa (Sardaigne), Acque SpA (Toscane), Lario Reti, SAL Lodi…
- Stratégie : un module par gestore, top 10 gestori ≈ 500–1 000 comuni. Effort : 4–6 jours.

#### 3b. Espagne — `data/build_spain.py`
- SINAC (sinacv2.sanidad.gob.es) = bulletins PDF par municipio, pas de bulk (déjà investigué) ; Datadista/infoagua.es = nitrates seulement
- Voie réaliste : scraping par grande compagnie : **Canal de Isabel II** (région de Madrid, 179 municipios), **Aigües de Barcelona** (36 communes AMB), EMASESA (Séville), Global Omnium (Valence), Aguas de Murcia, EMALCSA (La Corogne), Aqualia (~1 100 municipios si pages accessibles)
- Rendement : 200–400 municipios. Effort : 4–6 jours.

#### 3c. Portugal — `data/build_portugal.py`
- **ERSAR** « Pesquisa por concelho » (ersar.pt) : indicateur água segura par concelho (308 concelhos) — mais les paramètres physico-chimiques détaillés sont chez les entités gestionnaires (EPAL Lisbonne, Águas do Porto, Águas do Algarve… publient leurs analyses par zone d'approvisionnement)
- Rendement : ~50–150 concelhos avec vrais paramètres. Effort : 2–3 jours.

### Compléments optionnels (pays déjà corrects)
- **Danemark** : base GEUS Jupiter (open data forages/qualité) si l'on veut passer de 68 à ~98 communes
- **Irlande** : rapports EPA par supply zone (20 → ~80)
- **Grèce** : 14 villes scorées sans polygone (pertes de matching LAU) — vérifier les noms translittérés dans `build_eu_places.py`

---

## 4. Ordre d'exécution recommandé et rendement cumulé

| # | Chantier | Effort | Villes/polygones gagnés |
|---|----------|--------|------------------------|
| 1 | Contours geoBoundaries (UA, MD, BA, ME, XK, BY…) | ½ j | **+~580 polygones** (données déjà là) |
| 2 | Belgique (ODWB + compagnies) | 1–2 j | +300–580 communes |
| 3 | Pays-Bas (10 compagnies) | 2–3 j | +~340 gemeenten |
| 4 | Allemagne amorce (Wikipedia 80 villes) | 1 j | +80 villes |
| 5 | Royaume-Uni (compagnies + contours ONS) | 3–5 j | +100–300 villes |
| 6 | Allemagne Stadtwerke | 3–5 j | +400 villes |
| 7 | Italie (top 10 gestori) | 4–6 j | +500–1 000 comuni |
| 8 | Espagne (grandes compagnies) | 4–6 j | +200–400 municipios |
| 9 | Portugal (ERSAR + entités) | 2–3 j | +50–150 concelhos |

Après les étapes 1–4 (≈ 1 semaine), plus aucun grand pays européen n'apparaît vide ; après la phase 3, la densité DE/IT/ES devient comparable aux pays LAU déjà couverts (AT/CH/PL).

## 5. Contraintes à respecter
- Ne jamais relancer le pipeline France (`data/compute_scores.py`) ni `workflow_dispatch` sur `update-data.yml`
- Déploiement uniquement via `git subtree split --prefix public master` → push `gh-pages`
- Attribution : © EuroGeographics (LAU), geoBoundaries (CC BY), OGL (ONS UK) — à ajouter par source dans MapLibre
- Chaque importeur : téléchargements bruts cachés dans `data/<source>/` (gitignoré), sortie committée dans `data/world/`

## 6. Sources vérifiées (2026-07-13)
- Belgique/Wallonie : https://www.odwb.be/explore/dataset/zones-de-distribution-en-eau-wallonie/ · https://environnement.wallonie.be/actualite/un-nouvel-outil-cartographique-pour-consulter-la-qualite-de-l-eau-potable-en-wallonie
- Pays-Bas : REWAB non public (https://www.kwrwater.nl/en/tools-producten/rewab/) → sites des 10 compagnies
- Allemagne : https://www.trinkwasserdatenbank.de/ · https://de.wikipedia.org/wiki/Liste_der_Trinkwasserversorgung_deutscher_Großstädte · (commercial) https://leitungswasserqualität.de/
- UK : https://www.stwater.co.uk/my-supply/water-quality/check-my-water-quality/ · https://waterquality.anglianwater.com/map.aspx · DWI
- Portugal : https://www.ersar.pt/pt/consumidor/qualidade-da-agua/pesquisa-por-concelho
- Italie : https://www.gruppohera.it/ (acqua di casa tua) · https://www.aceaato2.a-acqua.it/qualita-acqua · https://www.acque.net/lacqua/acqua-di-casa-tua/
- Contours : https://www.geoboundaries.org/ · ONS Open Geography Portal
