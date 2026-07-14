import { colorFromScore, labelFromScore } from './scoring.js';
import { renderWorldCityPanel, renderWorldCountryPanel, renderNoDataPanel } from './world-panel.js';
import { updatePanel } from './panel.js';
import { searchLocalCities, searchNominatim, escapeHtml } from './world-search.js';

const COUNTRIES_GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
const COMMUNES_GEOJSON_URL  = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson';
const PROVINCES_GEOJSON_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson';
const US_COUNTIES_GEOJSON_URL = 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json';

// Layer architecture (bottom to top):
// Pays "normaux" (Europe, petits pays, NOPROV_4) : countries-fill (0-4)
//   → world-provinces-fill (4+) → eu-places-fill (4+) → communes-fill (4+, FR)
// Pays continentaux AVEC provinces NE (BIG_ISO2) — hiérarchie stricte sans
// superposition : big-countries-fill (0-3) → big-provinces-fill (3-5)
//   → us-counties-fill (4-5, USA) → us-places-fill / big-places-fill (5+)
// Pays continentaux SANS provinces NE : NOPROV_4 (MX/AR/PE) = pays 0-4 puis
// villes 4+ ; NOPROV_5 (DZ/CD) = noprov5-countries-fill 0-5 puis villes 5+.

// Pays de taille continentale (>= ~1,2 M km²) AVEC provinces dans Natural
// Earth 1:50m : hiérarchie Pays (0-3) → Provinces (3-5) → Villes (5+).
const BIG_ISO2 = ['US', 'CN', 'RU', 'CA', 'BR', 'AU', 'ZA', 'IN'];
const BIG_IN_ISO2 = ['in', ['get', 'iso2'], ['literal', BIG_ISO2]];
// Pays continentaux SANS provinces NE 1:50m (AR/MX/DZ/CD/PE : 0 polygone
// admin-1) : le choroplèthe pays reste affiché jusqu'à l'arrivée des villes.
const NOPROV_4 = ['MX', 'AR', 'PE'];  // polygones denses → villes dès 4
const NOPROV_5 = ['DZ', 'CD'];        // données éparses → pays jusqu'à 5

// FIPS state code → USPS abbreviation (county names repeat across states)
const _FIPS_STATE = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
  '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
  '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
  '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
  '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
  '54':'WV','55':'WI','56':'WY','72':'PR'
};

// ── Tâche 3 : configuration des métriques individuelles ────────────────────
// Stratégie choisie : precalcul des couleurs par metrique dans les proprietes GeoJSON
// puis setData() sur chaque source au changement de metrique.
// Avantage : pas de gestion d'état de couche complexe ; compatible avec le flux lazy de communes.
const METRICS = {
  score: { label: 'Score SCA', param: null },
  ca_hardness: {
    label: 'Dureté calcique',
    lo: 50, hi: 85, minVal: 0, maxVal: 170
  },
  alkalinity: {
    label: 'Alcalinité',
    lo: 40, hi: 70, minVal: 0, maxVal: 140
  },
  ph: {
    label: 'pH',
    lo: 6.5, hi: 7.5, minVal: 4, maxVal: 10
  },
  tds: {
    label: 'TDS',
    lo: 75, hi: 250, minVal: 0, maxVal: 500
  },
  na: {
    label: 'Sodium',
    lo: 0, hi: 30, minVal: 0, maxVal: 100
  },
  cl: {
    label: 'Chlorures',
    lo: 0, hi: 75, minVal: 0, maxVal: 200
  }
};

// Calcule le sous-score lineaire d'une valeur par rapport aux plages SCA d'une metrique
function _metricSubScore(value, metric) {
  if (value == null || metric === 'score') return null;
  const cfg = METRICS[metric];
  if (!cfg || cfg.param === null) return null;
  const { lo, hi, minVal, maxVal } = cfg;
  if (value >= lo && value <= hi) return 1.0;
  if (value < lo) {
    const span = lo - minVal;
    return span > 0 ? Math.max(0, 1 - (lo - value) / span) : 0;
  }
  const span = maxVal - hi;
  return span > 0 ? Math.max(0, 1 - (value - hi) / span) : 0;
}

// Couleur d'une valeur de parametre individuel selon sous-score lineaire
function _colorFromMetricValue(value, metric) {
  const sub = _metricSubScore(value, metric);
  return colorFromScore(sub);
}

// Moyenne des valeurs d'un parametre sur une liste de villes
function _avgParam(cities, metric) {
  const vals = cities.map(c => c.params?.[metric]).filter(v => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

let map = null;
let worldCities = [];
let worldCountries = [];
let communesData = {};
let franceGeojson = null;
let _franceLoaded    = false;
let _provincesLoaded = false;
let _usCountiesLoaded = false;
let _usCountiesGeo    = null;    // reference GeoJSON comtés pour recoloration métrique
let _usCountiesData   = new Map(); // fips → { avg_score, cities, scored_count, name }
let _usPlacesLoaded   = false;
let _usPlacesGeo      = null;    // polygones municipaux Census (villes scorées uniquement)
let _euPlacesLoaded   = false;
let _euPlacesGeo      = null;    // polygones municipaux GISCO LAU (Europe hors France)
let _cityById         = new Map(); // id → city (join us/eu-places ↔ worldCities)
let _provincesData   = new Map(); // `${iso2}__${name}` → { avg_score, cities, scored_count, name }
let _citiesByCountry = new Map(); // iso2 → city[]
let _iso3toIso2      = new Map(); // ISO 3166-1 alpha-3 → alpha-2 (built from countries GeoJSON)
let _theme = localStorage.getItem('sca-theme') || 'dark';
let _searchTimer        = null;
let _lastNominatimQuery = '';
let _currentMetric = 'score'; // metrique active pour Tâche 3
let _countriesGeo   = null;   // reference GeoJSON countries pour recoloration
let _provincesGeo   = null;   // reference GeoJSON provinces pour recoloration
let _countriesMap   = null;   // Map iso2 → countryData

// Ray-casting point-in-polygon for a single ring
function _pip(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function _cityInPolygon(lng, lat, feature) {
  const { type, coordinates } = feature.geometry;
  if (type === 'Polygon') return _pip(lng, lat, coordinates[0]);
  if (type === 'MultiPolygon') return coordinates.some(poly => _pip(lng, lat, poly[0]));
  return false;
}

// Bounding box [minLng, minLat, maxLng, maxLat] of a feature — cheap pre-filter
// before the exact PIP test (3143 counties × 1300 US cities would be costly raw).
function _featureBbox(feature) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const scan = ring => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };
  const { type, coordinates } = feature.geometry;
  if (type === 'Polygon') coordinates.forEach(scan);
  else if (type === 'MultiPolygon') coordinates.forEach(poly => poly.forEach(scan));
  return [minLng, minLat, maxLng, maxLat];
}

// ── Tâche 1 : légende repliable ────────────────────────────────────────────
function _initLegend() {
  const legend  = document.getElementById('legend');
  const togBtn  = document.getElementById('legend-toggle');
  const body    = document.getElementById('legend-body');
  if (!legend || !togBtn || !body) return;

  const stored = localStorage.getItem('sca-legend-collapsed');
  if (stored === '1') {
    legend.classList.add('collapsed');
    togBtn.textContent = '+';
  }

  togBtn.addEventListener('click', () => {
    const collapsed = legend.classList.toggle('collapsed');
    togBtn.textContent = collapsed ? '+' : '−';
    localStorage.setItem('sca-legend-collapsed', collapsed ? '1' : '0');
  });
}

// ── Tâche 2 : tooltip ──────────────────────────────────────────────────────
function _initTooltip() {
  const tooltip    = document.getElementById('map-tooltip');
  const mapEl      = document.getElementById('map');
  const isTouchDevice = window.matchMedia('(hover: none)').matches;
  if (!tooltip || !mapEl || isTouchDevice) return;

  // Layers a surveiller, du plus fin au plus grossier
  const HOVER_LAYERS = ['communes-fill', 'us-places-fill', 'eu-places-fill', 'big-places-fill', 'us-counties-fill', 'world-provinces-fill', 'big-provinces-fill', 'countries-fill', 'big-countries-fill', 'noprov5-countries-fill'];

  map.on('mousemove', (e) => {
    // Priorite a la couche la plus fine sous le curseur
    let hit = null;
    for (const layer of HOVER_LAYERS) {
      if (!map.getLayer(layer)) continue;
      const feats = map.queryRenderedFeatures(e.point, { layers: [layer] });
      if (feats.length) { hit = { layer, feat: feats[0] }; break; }
    }

    if (!hit) {
      tooltip.style.display = 'none';
      return;
    }

    let name = '';
    let score = null;
    let note = '';
    const p = hit.feat.properties;

    if (hit.layer === 'communes-fill') {
      const code  = p.code;
      const cData = communesData[code];
      name  = cData?.nom || p.nom || p.name || code || '—';
      score = cData?.score ?? null;
    } else if (hit.layer === 'us-places-fill') {
      const city = _cityById.get(p.city_id);
      name  = p.name + (p.st ? `, ${p.st}` : '');
      score = city?.score ?? null;
      if (city?.deg) note = ' (estimé sans dureté)';
    } else if (hit.layer === 'eu-places-fill' || hit.layer === 'big-places-fill') {
      const city = _cityById.get(p.city_id);
      name  = p.name + (p.c ? `, ${p.c}` : '');
      score = city?.score ?? null;
      if (city?.deg) note = ' (estimé sans dureté)';
    } else if (hit.layer === 'us-counties-fill') {
      const st = _FIPS_STATE[p.STATE] || '';
      name  = p.NAME + (st ? `, ${st}` : '');
      score = p.avg_score != null ? parseFloat(p.avg_score) : null;
    } else if (hit.layer === 'world-provinces-fill' || hit.layer === 'big-provinces-fill') {
      name  = p.name || '—';
      score = p.avg_score != null ? parseFloat(p.avg_score) : null;
      if (score == null && p.natl_score != null) {
        score = parseFloat(p.natl_score);
        note  = ' (moyenne nationale)';
      }
    } else {
      // countries-fill : propriete 'ADMIN' dans geo-countries GeoJSON
      name  = p['ADMIN'] || p['NAME'] || p['name'] || '—';
      const iso2 = p['ISO3166-1-Alpha-2'];
      const cData = iso2 ? _countriesMap?.get(iso2) : null;
      score = cData?.avg_score ?? null;
    }

    const pct = score != null ? Math.round(score * 100) + ' %' : null;
    const col = colorFromScore(score);
    const scoreHtml = pct
      ? `<span style="color:${col};font-weight:bold"> ${pct}</span>`
      : `<span style="color:var(--muted)"> Pas de données</span>`;
    const noteHtml = note ? `<span style="color:var(--muted);font-size:10px">${note}</span>` : '';

    tooltip.innerHTML = `<span style="color:var(--text)">${escapeHtml(name)}</span>${scoreHtml}${noteHtml}`;
    tooltip.style.display = 'block';

    // Positionnement : suit le curseur avec offset pour eviter le chevauchement
    const rect  = mapEl.getBoundingClientRect();
    const tx    = e.originalEvent.clientX - rect.left + 14;
    const ty    = e.originalEvent.clientY - rect.top  - 28;
    tooltip.style.left = tx + 'px';
    tooltip.style.top  = ty + 'px';
  });

  map.on('mouseleave', () => { tooltip.style.display = 'none'; });

  // Curseur pointer sur les couches cliquables
  for (const layer of HOVER_LAYERS) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
}

// ── Tâche 3 : recoloration des sources selon la metrique active ────────────
function _recolorCountries(metric) {
  if (!_countriesGeo || !map.getSource('countries')) return;
  for (const f of _countriesGeo.features) {
    const iso2 = f.properties['ISO3166-1-Alpha-2'];
    if (metric === 'score') {
      const cData = _countriesMap?.get(iso2);
      f.properties.color = colorFromScore(cData?.avg_score);
    } else {
      // France : moyenne sur communesData ; autres pays : moyenne sur worldCities
      let avg = null;
      if (iso2 === 'FR') {
        const vals = Object.values(communesData)
          .map(c => c.params?.[metric])
          .filter(v => v != null);
        avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      } else {
        const cities = _citiesByCountry.get(iso2) || [];
        avg = _avgParam(cities, metric);
      }
      f.properties.color = _colorFromMetricValue(avg, metric);
    }
  }
  map.getSource('countries').setData(_countriesGeo);
}

// Moyenne nationale d'un parametre (France via communesData, sinon worldCities)
function _countryParamAvg(iso2, metric) {
  if (iso2 === 'FR') {
    const vals = Object.values(communesData)
      .map(c => c.params?.[metric])
      .filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return _avgParam(_citiesByCountry.get(iso2) || [], metric);
}

function _recolorProvinces(metric) {
  if (!_provincesGeo || !map.getSource('world-provinces')) return;
  for (const f of _provincesGeo.features) {
    const iso2 = f.properties.iso2;
    if (metric === 'score') {
      f.properties.color = colorFromScore(f.properties.avg_score ?? f.properties.natl_score);
    } else {
      const pd   = _provincesData.get(`${iso2}__${f.properties.name}`);
      let avg    = _avgParam(pd?.cities || [], metric);
      // Repli hiérarchique identique au mode score
      if (avg == null && iso2) avg = _countryParamAvg(iso2, metric);
      f.properties.color = _colorFromMetricValue(avg, metric);
    }
  }
  map.getSource('world-provinces').setData(_provincesGeo);
}

function _recolorCommunes(metric) {
  if (!franceGeojson || !map.getSource('communes')) return;
  for (const f of franceGeojson.features) {
    const code  = f.properties.code;
    const cData = communesData[code];
    if (metric === 'score') {
      f.properties.color = colorFromScore(cData?.score);
    } else {
      const val = cData?.params?.[metric] ?? null;
      f.properties.color = _colorFromMetricValue(val, metric);
    }
  }
  map.getSource('communes').setData(franceGeojson);
}

function _recolorUsCounties(metric) {
  if (!_usCountiesGeo || !map.getSource('us-counties')) return;
  for (const f of _usCountiesGeo.features) {
    const cd = _usCountiesData.get(f.id);
    if (metric === 'score') {
      f.properties.color = colorFromScore(cd?.avg_score);
    } else {
      const avg = _avgParam(cd?.cities || [], metric);
      f.properties.color = _colorFromMetricValue(avg, metric);
    }
  }
  map.getSource('us-counties').setData(_usCountiesGeo);
}

// Recolore une source de polygones municipaux (jointure city_id → worldCities)
function _recolorPlaces(geo, sourceId, metric) {
  if (!geo || !map.getSource(sourceId)) return;
  for (const f of geo.features) {
    const city = _cityById.get(f.properties.city_id);
    if (metric === 'score') {
      f.properties.color = colorFromScore(city?.score);
    } else {
      const val = city?.params?.[metric] ?? null;
      f.properties.color = _colorFromMetricValue(val, metric);
    }
  }
  map.getSource(sourceId).setData(geo);
}

function _recolorUsPlaces(metric) { _recolorPlaces(_usPlacesGeo, 'us-places', metric); }
function _recolorEuPlaces(metric) { _recolorPlaces(_euPlacesGeo, 'eu-places', metric); }

function _makeHatchPattern() {
  const size = 12;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = 'rgba(13,17,23,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  // diagonale centrale + coins pour un raccord de tuile invisible
  ctx.moveTo(0, size); ctx.lineTo(size, 0);
  ctx.moveTo(-size * 0.25, size * 0.25); ctx.lineTo(size * 0.25, -size * 0.25);
  ctx.moveTo(size * 0.75, size * 1.25); ctx.lineTo(size * 1.25, size * 0.75);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

// Les hachures ne concernent que le mode score (une metrique mesuree, ex. pH,
// n'est pas "estimee") — visibilite basculee par _applyMetric.
const HATCH_LAYERS = ['us-places-hatch', 'eu-places-hatch', 'big-places-hatch'];

function _applyMetric(metric) {
  _currentMetric = metric;
  for (const l of HATCH_LAYERS) {
    if (map.getLayer(l)) {
      map.setLayoutProperty(l, 'visibility', metric === 'score' ? 'visible' : 'none');
    }
  }
  // Mise a jour du titre de la legende
  const legendTitle = document.getElementById('legend-title');
  if (legendTitle) {
    legendTitle.textContent = METRICS[metric]?.label || 'Score SCA';
  }
  _recolorCountries(metric);
  _recolorProvinces(metric);
  _recolorUsCounties(metric);
  _recolorUsPlaces(metric);
  _recolorEuPlaces(metric);
  _recolorCommunes(metric);
}

function _initMetricSelect() {
  const sel = document.getElementById('metric-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    _applyMetric(sel.value);
  });
}

// ── Tâche 4 : permaliens ───────────────────────────────────────────────────
function _parseHash() {
  const hash = window.location.hash.replace('#', '');
  const parts = hash.split('/');
  if (parts.length === 3) {
    const zoom = parseFloat(parts[0]);
    const lat  = parseFloat(parts[1]);
    const lng  = parseFloat(parts[2]);
    if (!isNaN(zoom) && !isNaN(lat) && !isNaN(lng)
        && zoom >= 0 && zoom <= 22
        && lat >= -90 && lat <= 90
        && lng >= -180 && lng <= 180) {
      return { zoom, lat, lng };
    }
  }
  return null;
}

function _syncHash() {
  if (!map) return;
  const z   = map.getZoom().toFixed(2);
  const lat = map.getCenter().lat.toFixed(5);
  const lng = map.getCenter().lng.toFixed(5);
  history.replaceState(null, '', `#${z}/${lat}/${lng}`);
}

function _initPermalink() {
  // Synchronisation hash a chaque fin de deplacement
  map.on('moveend', _syncHash);

  // Bouton copie de lien
  const btn = document.getElementById('btn-copy-link');
  if (!btn) return;
  btn.addEventListener('click', () => {
    _syncHash(); // assure que le hash est a jour
    navigator.clipboard.writeText(window.location.href).then(() => {
      btn.classList.add('copied');
      const orig = btn.textContent;
      btn.textContent = 'Lien copie !';
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('copied');
      }, 1800);
    }).catch(() => {
      // Fallback pour navigateurs sans Clipboard API (http, iframes)
      const ta = document.createElement('textarea');
      ta.value = window.location.href;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = 'Lien copie !';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Lien'; btn.classList.remove('copied'); }, 1800);
    });
  });
}

async function init() {
  // Fetch local data + countries GeoJSON in parallel.
  // Countries GeoJSON is used both for the countries layer and to build the iso3→iso2 map.
  const [citiesRes, countriesRes, communesRes, countriesGeoRes] = await Promise.all([
    fetch('./world-cities.json'),
    fetch('./world-countries.json'),
    fetch('./communes.json'),
    fetch(COUNTRIES_GEOJSON_URL)
  ]);

  if (citiesRes.ok) worldCities = await citiesRes.json();
  if (countriesRes.ok) worldCountries = await countriesRes.json();
  if (communesRes.ok) {
    const data = await communesRes.json();
    const list = data.communes || data.data || data;
    if (Array.isArray(list)) {
      for (const c of list) { if (c.insee) communesData[c.insee] = c; }
    } else {
      communesData = list;
    }
  }

  // Compute France avg_score from communes (corrects bad geocoding in world-countries.json)
  const communeScores = Object.values(communesData).map(c => c.score).filter(s => s != null);
  const frAvgScore = communeScores.length
    ? communeScores.reduce((a, b) => a + b, 0) / communeScores.length
    : null;

  _countriesMap = new Map(worldCountries.map(c => [c.iso2, c]));
  if (frAvgScore != null) {
    const frEntry = _countriesMap.get('FR') || {};
    _countriesMap.set('FR', {
      ...frEntry,
      iso2: 'FR',
      name: 'France',
      avg_score: frAvgScore,
      city_count: communeScores.length,
      scored_count: communeScores.length
    });
  }

  // Build iso3→iso2 map and color countries GeoJSON (single fetch, no duplicate load)
  // geo-countries inherits Natural Earth's "-99" ISO codes for a few disputed/special
  // entries — patch the ones we have data for, keyed by feature name.
  const ISO_FIXES = { 'France': ['FR', 'FRA'], 'Norway': ['NO', 'NOR'], 'Kosovo': ['XK', 'XKX'] };
  let countriesGeo = null;
  if (countriesGeoRes.ok) {
    countriesGeo = await countriesGeoRes.json();
    for (const f of countriesGeo.features) {
      let a2 = f.properties['ISO3166-1-Alpha-2'];
      let a3 = f.properties['ISO3166-1-Alpha-3'];
      if ((!a2 || a2 === '-99') && ISO_FIXES[f.properties.name]) {
        [a2, a3] = ISO_FIXES[f.properties.name];
        f.properties['ISO3166-1-Alpha-2'] = a2; // in place: click/tooltip handlers use it
        f.properties['ISO3166-1-Alpha-3'] = a3;
      }
      if (a2 && a3 && a2 !== '-99') _iso3toIso2.set(a3, a2);
      const cData = _countriesMap.get(a2);
      f.properties.color = colorFromScore(cData?.avg_score);
    }
    _countriesGeo = countriesGeo; // conserve la reference pour recoloration Tâche 3
  }
  // Natural Earth uses its own alpha-3 for Kosovo in the provinces file
  _iso3toIso2.set('FRA', 'FR');
  _iso3toIso2.set('NOR', 'NO');
  _iso3toIso2.set('KOS', 'XK');

  // Group cities by country ISO2 for efficient province-level PIP
  for (const city of worldCities) {
    if (!_citiesByCountry.has(city.country)) _citiesByCountry.set(city.country, []);
    _citiesByCountry.get(city.country).push(city);
    _cityById.set(city.id, city);
  }

  // Tâche 4 : lire le hash initial pour positionner la carte
  const initialView = _parseHash();

  map = new maplibregl.Map({
    container: 'map',
    style: _theme === 'light'
      ? 'https://tiles.openfreemap.org/styles/positron'
      : 'https://tiles.openfreemap.org/styles/dark',
    center: initialView ? [initialView.lng, initialView.lat] : [10, 20],
    zoom:   initialView ? initialView.zoom : 2,
    maxZoom: 16
  });

  map.on('load', async () => {
    // Motif de hachures diagonales pour les scores estimes sans durete
    // (superpose a la couleur via des couches fill-pattern dediees)
    map.addImage('hatch-pattern', _makeHatchPattern(), { pixelRatio: 2 });
    // 1. Countries choropleth — no maxzoom here; zoom range will be restricted to 0–4
    // only after provinces layers are successfully added (P1: avoid blank-map gap).
    map.addSource('countries', {
      type: 'geojson',
      data: countriesGeo || COUNTRIES_GEOJSON_URL
    });
    // Pays continentaux séparés : choroplèthe pays jusqu'à 3 (provinces en
    // relais) pour BIG_ISO2, jusqu'à 5 pour NOPROV_5 (pas de provinces NE,
    // données éparses) ; les autres pays (dont NOPROV_4) vont jusqu'à 4.
    const isBigCountry = ['in', ['get', 'ISO3166-1-Alpha-2'], ['literal', BIG_ISO2]];
    const isNoProv5 = ['in', ['get', 'ISO3166-1-Alpha-2'], ['literal', NOPROV_5]];
    const countryPaint = {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.65
    };
    map.addLayer({
      id: 'countries-fill',
      type: 'fill',
      source: 'countries',
      filter: ['!', ['any', isBigCountry, isNoProv5]],
      paint: countryPaint
    });
    map.addLayer({
      id: 'big-countries-fill',
      type: 'fill',
      source: 'countries',
      filter: isBigCountry,
      paint: countryPaint
    });
    map.addLayer({
      id: 'noprov5-countries-fill',
      type: 'fill',
      source: 'countries',
      filter: isNoProv5,
      paint: countryPaint
    });
    map.addLayer({
      id: 'countries-line',
      type: 'line',
      source: 'countries',
      filter: ['!', isNoProv5],
      paint: { 'line-color': '#444', 'line-width': 0.5 }
    });
    map.addLayer({
      id: 'noprov5-countries-line',
      type: 'line',
      source: 'countries',
      filter: isNoProv5,
      paint: { 'line-color': '#444', 'line-width': 0.5 }
    });

    // Eagerly kick off the provinces fetch in the background (P1).
    // No await — countries layers stay visible at all zooms until provinces are ready.
    _loadWorldProvincesGeojson();

    // 2. moveend: lazy-load communes when in France at zoom 4+; provinces are now eager (P1).
    map.on('moveend', () => {
      const z = map.getZoom();
      const c = map.getCenter();

      // Wide bbox to catch France in view at low zoom; strict bbox for UI changes
      const inFranceArea = z >= 4
        && c.lng > -8 && c.lng < 12
        && c.lat > 39 && c.lat < 53;

      const inFranceStrict = z >= 7
        && c.lng > -5.5 && c.lng < 10.0
        && c.lat > 41.0 && c.lat < 51.5;

      document.getElementById('btn-toggle-view').hidden = !inFranceStrict;
      document.getElementById('search').placeholder = inFranceStrict
        ? '🔍  Commune ou n° de dép...'
        : '🔍  Ville ou pays...';

      // Wide US bbox (Alaska/Hawaii included) — comtés dès le zoom 4,
      // préchargement à partir de 3
      const inUsArea = z >= 3
        && c.lng > -180 && c.lng < -60
        && c.lat > 15 && c.lat < 73;

      if (inFranceArea) _loadFranceGeojson();
      if (inUsArea) { _loadUsCountiesGeojson(); _loadUsPlacesGeojson(); }
      // eu-places + extra-places couvrent desormais l'Europe ET le reste du
      // monde (geoBoundaries) : chargement au zoom 4+ quelle que soit la zone
      if (z >= 4) _loadEuPlacesGeojson();
      // provinces are loaded eagerly; no moveend trigger needed for them
    });

    // 3. Country click → panel + optional France zoom
    const countryClick = (e) => {
      const iso = e.features[0].properties['ISO3166-1-Alpha-2'];
      const data = _countriesMap.get(iso);
      if (!data) return;

      const topCities = worldCities
        .filter(c => c.country === iso && c.score != null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      document.getElementById('panel-content').innerHTML = renderWorldCountryPanel(data, topCities);
      document.getElementById('panel-empty').hidden = true;
      document.getElementById('panel-content').hidden = false;

      if (iso === 'FR') {
        map.fitBounds([[-5.5, 41.0], [10.0, 51.5]], { padding: 20 });
        _loadFranceGeojson();
      }
    };
    map.on('click', 'countries-fill', countryClick);
    map.on('click', 'big-countries-fill', countryClick);
    map.on('click', 'noprov5-countries-fill', countryClick);

    // Tâche 1 : legende repliable
    _initLegend();

    // Tâche 2 : tooltip
    _initTooltip();

    // Tâche 3 : selecteur de metrique
    _initMetricSelect();

    // Tâche 4 : permaliens
    _initPermalink();
  });

  // Home Button
  document.getElementById('btn-home').addEventListener('click', () => {
    map.flyTo({ center: [10, 20], zoom: 2 });
  });

  // Hybrid search
  const searchInput   = document.getElementById('search');
  const searchResults = document.getElementById('search-results');

  function _showResults(localItems, nominatimItems) {
    if (!localItems.length && !nominatimItems.length) {
      searchResults.hidden = true;
      return;
    }
    let html = '';
    for (const c of localItems) {
      const col = colorFromScore(c.score);
      const pct = c.score != null ? Math.round(c.score * 100) + ' %' : '—';
      html += `<div class="search-item" data-city-id="${escapeHtml(c.id)}">
        <span class="search-item-name">${escapeHtml(c.name)}</span>
        <span class="search-item-country">${escapeHtml(c.country_name)}</span>
        <span class="search-item-score" style="background:${col}20;color:${col}">${pct}</span>
      </div>`;
    }
    for (const n of nominatimItems) {
      const shortName = n.display_name.split(',')[0];
      const shortLoc  = n.display_name.split(',').slice(1, 3).join(',').trim();
      html += `<div class="search-item" data-lat="${escapeHtml(n.lat)}" data-lon="${escapeHtml(n.lon)}" data-display="${escapeHtml(shortName)}">
        <span class="search-item-name">${escapeHtml(shortName)}</span>
        <span class="search-item-loc">📍 ${escapeHtml(shortLoc)}</span>
      </div>`;
    }
    if (nominatimItems.length > 0) {
      html += `<div class="search-osm-credit">© OpenStreetMap contributors</div>`;
    }
    searchResults.innerHTML = html;
    searchResults.hidden = false;
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { searchResults.hidden = true; return; }

    const local = searchLocalCities(worldCities, q);
    _showResults(local, []);

    if (local.length === 0) {
      _searchTimer = setTimeout(async () => {
        if (q !== searchInput.value.trim()) return;
        _lastNominatimQuery = q;
        const nominatim = await searchNominatim(q);
        if (q !== _lastNominatimQuery) return;
        _showResults([], nominatim);
      }, 400);
    }
  });

  searchResults.addEventListener('click', e => {
    const item = e.target.closest('.search-item');
    if (!item) return;
    searchInput.value = '';
    searchResults.hidden = true;

    if (item.dataset.cityId) {
      const city = worldCities.find(c => c.id === item.dataset.cityId);
      if (!city) return;
      map.flyTo({ center: [city.lng, city.lat], zoom: 6 });
      document.getElementById('panel-content').innerHTML = renderWorldCityPanel(city);
      document.getElementById('panel-empty').hidden  = true;
      document.getElementById('panel-content').hidden = false;
    } else if (item.dataset.lat) {
      map.flyTo({ center: [parseFloat(item.dataset.lon), parseFloat(item.dataset.lat)], zoom: 10 });
      document.getElementById('panel-content').innerHTML = renderNoDataPanel(item.dataset.display);
      document.getElementById('panel-empty').hidden  = true;
      document.getElementById('panel-content').hidden = false;
    }
  });

  document.addEventListener('click', e => {
    if (!document.getElementById('search-wrapper').contains(e.target)) {
      searchResults.hidden = true;
    }
  });

  document.getElementById('panel-content').addEventListener('click', e => {
    const row = e.target.closest('.top-city-row');
    if (!row) return;
    const city = worldCities.find(c => c.id === row.dataset.cityId);
    if (!city) return;
    map.flyTo({ center: [city.lng, city.lat], zoom: 6 });
    document.getElementById('panel-content').innerHTML = renderWorldCityPanel(city);
  });
}

async function _loadWorldProvincesGeojson() {
  if (_provincesLoaded) return;
  _provincesLoaded = true;

  let r;
  try {
    r = await fetch(PROVINCES_GEOJSON_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error('World provinces GeoJSON fetch failed:', e.message);
    _provincesLoaded = false;
    return;
  }

  const geo = await r.json();

  // P2: chunked async loop to avoid blocking the main thread during PIP computation
  const CHUNK = 300;
  for (let i = 0; i < geo.features.length; i++) {
    // Yield to the event loop every CHUNK features so the renderer can breathe
    if (i > 0 && i % CHUNK === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const f = geo.features[i];
    // adm0_a3 (e.g. "USA", "FRA") is always populated in Natural Earth; convert via iso3→iso2 map
    const adm0a3 = f.properties.adm0_a3;
    let iso2 = adm0a3 ? (_iso3toIso2.get(adm0a3) || null) : null;
    // Fallback: try iso_3166_2 prefix (e.g. "US-CA" → "US") for edge cases
    if (!iso2) {
      const raw = f.properties.iso_3166_2 || '';
      if (/^[A-Z]{2}/.test(raw)) iso2 = raw.substring(0, 2);
    }

    const candidates = (iso2 && _citiesByCountry.get(iso2)) || [];
    const cities  = candidates.filter(c => _cityInPolygon(c.lng, c.lat, f));
    const scored  = cities.filter(c => c.score != null);
    const avg     = scored.length ? scored.reduce((s, c) => s + c.score, 0) / scored.length : null;

    // Repli hiérarchique : sans ville scorée, la province hérite de la moyenne nationale
    // (couleur pleine, pas de superposition de couches → pas de teintes mélangées)
    const natlScore = iso2 ? (_countriesMap.get(iso2)?.avg_score ?? null) : null;

    f.properties.color        = colorFromScore(avg ?? natlScore);
    f.properties.avg_score    = avg;
    f.properties.natl_score   = avg == null ? natlScore : null;
    f.properties.city_count   = cities.length;
    f.properties.scored_count = scored.length;
    f.properties.iso2         = iso2;

    _provincesData.set(`${iso2}__${f.properties.name}`, {
      avg_score: avg, cities, scored_count: scored.length, name: f.properties.name
    });
  }

  _provincesGeo = geo; // conserve la reference pour recoloration Tâche 3

  // Si une metrique non-score est deja active, appliquer immediatement aux provinces
  if (_currentMetric !== 'score') {
    _recolorProvinces(_currentMetric);
  }

  // All PIP computation done; add source + layers, then restrict countries to zoom 0–4 (P1).
  map.addSource('world-provinces', { type: 'geojson', data: geo });
  map.addLayer({
    id: 'world-provinces-fill',
    type: 'fill',
    source: 'world-provinces',
    minzoom: 4,
    filter: ['!', BIG_IN_ISO2],
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.75
    }
  });
  map.addLayer({
    id: 'world-provinces-line',
    type: 'line',
    source: 'world-provinces',
    minzoom: 4,
    filter: ['!', BIG_IN_ISO2],
    paint: { 'line-color': '#555', 'line-width': 0.4 }
  });
  // Pays continentaux : provinces/etats de 3 a 5, puis les villes seules (5+).
  map.addLayer({
    id: 'big-provinces-fill',
    type: 'fill',
    source: 'world-provinces',
    minzoom: 3,
    maxzoom: 5,
    filter: BIG_IN_ISO2,
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.75
    }
  });
  map.addLayer({
    id: 'big-provinces-line',
    type: 'line',
    source: 'world-provinces',
    minzoom: 3,
    maxzoom: 5,
    filter: BIG_IN_ISO2,
    paint: { 'line-color': '#555', 'line-width': 0.4 }
  });

  // P1: now that provinces are live, cap countries so they don't overlap.
  // This is intentionally deferred until here — if fetch/PIP fails, countries stay visible at all zooms.
  map.setLayerZoomRange('countries-fill', 0, 4);
  map.setLayerZoomRange('big-countries-fill', 0, 3);
  map.setLayerZoomRange('noprov5-countries-fill', 0, 5);
  map.setLayerZoomRange('countries-line', 0, 4);
  map.setLayerZoomRange('noprov5-countries-line', 0, 5);

  const provinceClick = (e) => {
    // Un polygone municipal rendu sous le curseur prend la main
    // (queryRenderedFeatures respecte le minzoom de chaque couche)
    if (['us-places-fill', 'eu-places-fill', 'big-places-fill'].some(l =>
          map.getLayer(l) && map.queryRenderedFeatures(e.point, { layers: [l] }).length)) {
      return;
    }
    const iso2 = e.features[0].properties.iso2;
    // P3: if this is a French province, trigger commune load (fire-and-forget)
    // and skip the province panel only when communes-fill is already rendered.
    if (iso2 === 'FR') {
      _loadFranceGeojson();
      if (map.getLayer('communes-fill')) return;
    }
    // Same pattern for US: county layer takes over from zoom 5
    if (iso2 === 'US') {
      _loadUsCountiesGeojson();
      if (map.getLayer('us-counties-fill') && map.getZoom() >= 4) return;
    }
    const name = e.features[0].properties.name;
    const pd = _provincesData.get(`${iso2}__${name}`);
    if (!pd) return;
    const topCities = [...pd.cities]
      .filter(c => c.score != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    document.getElementById('panel-content').innerHTML = renderWorldCountryPanel(
      { name: pd.name, avg_score: pd.avg_score, city_count: pd.cities.length, scored_count: pd.scored_count },
      topCities
    );
    document.getElementById('panel-empty').hidden = true;
    document.getElementById('panel-content').hidden = false;
  };
  map.on('click', 'world-provinces-fill', provinceClick);
  map.on('click', 'big-provinces-fill', provinceClick);
}

async function _loadUsCountiesGeojson() {
  if (_usCountiesLoaded) return;
  _usCountiesLoaded = true;

  let r;
  try {
    r = await fetch(US_COUNTIES_GEOJSON_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error('US counties GeoJSON fetch failed:', e.message);
    _usCountiesLoaded = false;
    return;
  }

  const geo = await r.json();
  const usCities = _citiesByCountry.get('US') || [];

  // Chunked PIP with bbox pre-filter (3143 counties)
  const CHUNK = 300;
  for (let i = 0; i < geo.features.length; i++) {
    if (i > 0 && i % CHUNK === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const f = geo.features[i];
    const [minLng, minLat, maxLng, maxLat] = _featureBbox(f);
    const cities = usCities.filter(c =>
      c.lng >= minLng && c.lng <= maxLng &&
      c.lat >= minLat && c.lat <= maxLat &&
      _cityInPolygon(c.lng, c.lat, f)
    );
    const scored = cities.filter(c => c.score != null);
    const avg    = scored.length ? scored.reduce((s, c) => s + c.score, 0) / scored.length : null;

    f.properties.color        = colorFromScore(avg);
    f.properties.avg_score    = avg;
    f.properties.city_count   = cities.length;
    f.properties.scored_count = scored.length;
    // MapLibre may drop string feature ids in rendered-feature events — keep FIPS in properties
    f.properties.fips         = f.id;

    _usCountiesData.set(f.id, {
      avg_score: avg, cities, scored_count: scored.length, name: f.properties.NAME
    });
  }

  _usCountiesGeo = geo;

  // Si une metrique non-score est deja active, appliquer avant l'ajout visuel
  if (_currentMetric !== 'score') {
    for (const f of geo.features) {
      const cd = _usCountiesData.get(f.id);
      const avg = _avgParam(cd?.cities || [], _currentMetric);
      f.properties.color = _colorFromMetricValue(avg, _currentMetric);
    }
  }

  map.addSource('us-counties', { type: 'geojson', data: geo });
  // bande 4-5 : au-dela, seuls les polygones municipaux restent (pas de superposition)
  map.addLayer({
    id: 'us-counties-fill',
    type: 'fill',
    source: 'us-counties',
    minzoom: 4,
    maxzoom: 5,
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.80
    }
  });
  map.addLayer({
    id: 'us-counties-line',
    type: 'line',
    source: 'us-counties',
    minzoom: 4,
    maxzoom: 5,
    paint: { 'line-color': '#555', 'line-width': 0.3 }
  });

  map.on('click', 'us-counties-fill', (e) => {
    // Un polygone municipal rendu sous le curseur prend la main (zoom 5+ :
    // queryRenderedFeatures ne retourne rien tant que la couche n'est pas affichée)
    if (map.getLayer('us-places-fill')
        && map.queryRenderedFeatures(e.point, { layers: ['us-places-fill'] }).length) return;
    const f  = e.features[0];
    const cd = _usCountiesData.get(f.properties.fips ?? f.id);
    if (!cd) return;
    const st = _FIPS_STATE[f.properties.STATE] || '';
    const topCities = [...cd.cities]
      .filter(c => c.score != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    document.getElementById('panel-content').innerHTML = renderWorldCountryPanel(
      {
        name: cd.name + (st ? `, ${st}` : ''),
        avg_score: cd.avg_score,
        city_count: cd.cities.length,
        scored_count: cd.scored_count
      },
      topCities
    );
    document.getElementById('panel-empty').hidden = true;
    document.getElementById('panel-content').hidden = false;
  });
}

async function _loadUsPlacesGeojson() {
  if (_usPlacesLoaded) return;
  _usPlacesLoaded = true;

  let r;
  try {
    r = await fetch('./us-places.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error('US places GeoJSON fetch failed:', e.message);
    _usPlacesLoaded = false;
    return;
  }

  const geo = await r.json();

  // Join with worldCities: color each municipal polygon from its city score
  for (const f of geo.features) {
    const city = _cityById.get(f.properties.city_id);
    f.properties.color = colorFromScore(city?.score);
    if (city?.deg) f.properties.deg = 1; // score estime sans durete -> hachures
  }

  _usPlacesGeo = geo;

  // Si une metrique non-score est deja active, appliquer avant l'ajout visuel
  if (_currentMetric !== 'score') {
    for (const f of geo.features) {
      const city = _cityById.get(f.properties.city_id);
      const val = city?.params?.[_currentMetric] ?? null;
      f.properties.color = _colorFromMetricValue(val, _currentMetric);
    }
  }

  map.addSource('us-places', { type: 'geojson', data: geo });
  // USA : pays de taille continentale → hiérarchie complète Etat (4-5) →
  // Comté (5-7) → Ville (7+). L'Europe reste en Pays → Ville dès le zoom 4.
  map.addLayer({
    id: 'us-places-fill',
    type: 'fill',
    source: 'us-places',
    minzoom: 5,
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.85
    }
  });
  map.addLayer({
    id: 'us-places-line',
    type: 'line',
    source: 'us-places',
    minzoom: 5,
    paint: { 'line-color': '#21262d', 'line-width': 0.3 }
  });
  map.addLayer({
    id: 'us-places-hatch',
    type: 'fill',
    source: 'us-places',
    minzoom: 5,
    filter: ['==', ['get', 'deg'], 1],
    layout: { visibility: _currentMetric === 'score' ? 'visible' : 'none' },
    paint: { 'fill-pattern': 'hatch-pattern' }
  });

  map.on('click', 'us-places-fill', (e) => {
    const city = _cityById.get(e.features[0].properties.city_id);
    if (!city) return;
    document.getElementById('panel-content').innerHTML = renderWorldCityPanel(city);
    document.getElementById('panel-empty').hidden = true;
    document.getElementById('panel-content').hidden = false;
  });
}

async function _loadEuPlacesGeojson() {
  if (_euPlacesLoaded) return;
  _euPlacesLoaded = true;

  let r;
  try {
    r = await fetch('./eu-places.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error('EU places GeoJSON fetch failed:', e.message);
    _euPlacesLoaded = false;
    return;
  }

  const geo = await r.json();

  // extra-places.json : contours geoBoundaries pour les pays sans couche
  // dediee ni couverture LAU (Europe de l'Est, UK, Chine, Japon, Ameriques,
  // Afrique...), meme schema {city_id, name, c}, meme source. Non bloquant.
  try {
    const rx = await fetch('./extra-places.json');
    if (rx.ok) {
      const extra = await rx.json();
      geo.features = geo.features.concat(extra.features);
    }
  } catch (e) {
    console.warn('extra-places fetch failed:', e.message);
  }

  for (const f of geo.features) {
    const city = _cityById.get(f.properties.city_id);
    f.properties.color = colorFromScore(city?.score);
    if (city?.deg) f.properties.deg = 1; // score estime sans durete -> hachures
  }

  _euPlacesGeo = geo;

  if (_currentMetric !== 'score') {
    for (const f of geo.features) {
      const city = _cityById.get(f.properties.city_id);
      const val = city?.params?.[_currentMetric] ?? null;
      f.properties.color = _colorFromMetricValue(val, _currentMetric);
    }
  }

  map.addSource('eu-places', {
    type: 'geojson',
    data: geo,
    attribution: '© EuroGeographics (limites administratives) · geoBoundaries (CC BY 4.0)'
  });
  // Villes au zoom 5+ : pays continentaux a provinces (BIG_ISO2) et pays
  // continentaux epars (NOPROV_5, le choroplethe pays tient jusqu'a 5).
  // Les autres (Europe, NOPROV_4 : MX/AR/PE...) affichent leurs villes des 4.
  const isBig = ['in', ['get', 'c'], ['literal', [...BIG_ISO2, ...NOPROV_5]]];

  map.addLayer({
    id: 'eu-places-fill',
    type: 'fill',
    source: 'eu-places',
    minzoom: 4,
    filter: ['!', isBig],
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.85
    }
  });
  map.addLayer({
    id: 'eu-places-line',
    type: 'line',
    source: 'eu-places',
    minzoom: 4,
    filter: ['!', isBig],
    paint: { 'line-color': '#21262d', 'line-width': 0.3 }
  });
  map.addLayer({
    id: 'big-places-fill',
    type: 'fill',
    source: 'eu-places',
    minzoom: 5,
    filter: isBig,
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.85
    }
  });
  map.addLayer({
    id: 'big-places-line',
    type: 'line',
    source: 'eu-places',
    minzoom: 5,
    filter: isBig,
    paint: { 'line-color': '#21262d', 'line-width': 0.3 }
  });
  // Hachures des scores estimes sans durete (mode score uniquement)
  map.addLayer({
    id: 'eu-places-hatch',
    type: 'fill',
    source: 'eu-places',
    minzoom: 4,
    filter: ['all', ['!', isBig], ['==', ['get', 'deg'], 1]],
    layout: { visibility: _currentMetric === 'score' ? 'visible' : 'none' },
    paint: { 'fill-pattern': 'hatch-pattern' }
  });
  map.addLayer({
    id: 'big-places-hatch',
    type: 'fill',
    source: 'eu-places',
    minzoom: 5,
    filter: ['all', isBig, ['==', ['get', 'deg'], 1]],
    layout: { visibility: _currentMetric === 'score' ? 'visible' : 'none' },
    paint: { 'fill-pattern': 'hatch-pattern' }
  });

  const placeClick = (e) => {
    const city = _cityById.get(e.features[0].properties.city_id);
    if (!city) return;
    document.getElementById('panel-content').innerHTML = renderWorldCityPanel(city);
    document.getElementById('panel-empty').hidden = true;
    document.getElementById('panel-content').hidden = false;
  };
  map.on('click', 'eu-places-fill', placeClick);
  map.on('click', 'big-places-fill', placeClick);
}

async function _loadFranceGeojson() {
  if (_franceLoaded) return;
  _franceLoaded = true;

  let r;
  try {
    r = await fetch(COMMUNES_GEOJSON_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error('Communes GeoJSON fetch failed:', e.message);
    _franceLoaded = false;
    return;
  }
  franceGeojson = await r.json();

  franceGeojson.features.forEach(f => {
    const code = f.properties.code;
    const cData = communesData[code];
    f.properties.color = colorFromScore(cData?.score);
  });

  // Si une metrique non-score est deja active, appliquer immediatement aux communes
  if (_currentMetric !== 'score') {
    _recolorCommunes(_currentMetric);
  }

  map.addSource('communes', { type: 'geojson', data: franceGeojson });
  map.addLayer({
    id: 'communes-fill',
    type: 'fill',
    source: 'communes',
    minzoom: 4,
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.80
    }
  });
  map.addLayer({
    id: 'communes-line',
    type: 'line',
    source: 'communes',
    minzoom: 4,
    paint: { 'line-color': '#21262d', 'line-width': 0.3 }
  });

  map.on('click', 'communes-fill', (e) => {
    const code = e.features[0].properties.code;
    const cData = communesData[code];
    if (cData) {
      updatePanel(cData);
      document.getElementById('panel-empty').hidden = true;
      document.getElementById('panel-content').hidden = false;
    }
  });
}

init();
