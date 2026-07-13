import { colorFromScore, labelFromScore } from './scoring.js';
import { renderWorldCityPanel, renderWorldCountryPanel, renderNoDataPanel } from './world-panel.js';
import { updatePanel } from './panel.js';
import { searchLocalCities, searchNominatim, escapeHtml } from './world-search.js';

const COUNTRIES_GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
const COMMUNES_GEOJSON_URL  = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson';
const PROVINCES_GEOJSON_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson';

// Layer architecture (bottom to top):
// countries-fill (maxzoom:4) → world-provinces-fill (minzoom:4) → communes-fill (minzoom:4, France only)

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
  const HOVER_LAYERS = ['communes-fill', 'world-provinces-fill', 'countries-fill'];

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
    const p = hit.feat.properties;

    if (hit.layer === 'communes-fill') {
      const code  = p.code;
      const cData = communesData[code];
      name  = cData?.nom || p.nom || p.name || code || '—';
      score = cData?.score ?? null;
    } else if (hit.layer === 'world-provinces-fill') {
      name  = p.name || '—';
      score = p.avg_score != null ? parseFloat(p.avg_score) : null;
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

    tooltip.innerHTML = `<span style="color:var(--text)">${escapeHtml(name)}</span>${scoreHtml}`;
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

function _recolorProvinces(metric) {
  if (!_provincesGeo || !map.getSource('world-provinces')) return;
  for (const f of _provincesGeo.features) {
    if (metric === 'score') {
      f.properties.color = colorFromScore(f.properties.avg_score);
    } else {
      const iso2 = f.properties.iso2;
      const pd   = _provincesData.get(`${iso2}__${f.properties.name}`);
      const cities = pd?.cities || [];
      const avg    = _avgParam(cities, metric);
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

function _applyMetric(metric) {
  _currentMetric = metric;
  // Mise a jour du titre de la legende
  const legendTitle = document.getElementById('legend-title');
  if (legendTitle) {
    legendTitle.textContent = METRICS[metric]?.label || 'Score SCA';
  }
  _recolorCountries(metric);
  _recolorProvinces(metric);
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
  let countriesGeo = null;
  if (countriesGeoRes.ok) {
    countriesGeo = await countriesGeoRes.json();
    for (const f of countriesGeo.features) {
      const a2 = f.properties['ISO3166-1-Alpha-2'];
      const a3 = f.properties['ISO3166-1-Alpha-3'];
      if (a2 && a3) _iso3toIso2.set(a3, a2);
      const cData = _countriesMap.get(a2);
      f.properties.color = colorFromScore(cData?.avg_score);
    }
    _countriesGeo = countriesGeo; // conserve la reference pour recoloration Tâche 3
  }

  // Group cities by country ISO2 for efficient province-level PIP
  for (const city of worldCities) {
    if (!_citiesByCountry.has(city.country)) _citiesByCountry.set(city.country, []);
    _citiesByCountry.get(city.country).push(city);
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
    // 1. Countries choropleth — no maxzoom here; zoom range will be restricted to 0–4
    // only after provinces layers are successfully added (P1: avoid blank-map gap).
    map.addSource('countries', {
      type: 'geojson',
      data: countriesGeo || COUNTRIES_GEOJSON_URL
    });
    map.addLayer({
      id: 'countries-fill',
      type: 'fill',
      source: 'countries',
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
        'fill-opacity': 0.65
      }
    });
    map.addLayer({
      id: 'countries-line',
      type: 'line',
      source: 'countries',
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

      if (inFranceArea) _loadFranceGeojson();
      // provinces are loaded eagerly; no moveend trigger needed for them
    });

    // 3. Country click → panel + optional France zoom
    map.on('click', 'countries-fill', (e) => {
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
    });

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

    f.properties.color        = colorFromScore(avg);
    f.properties.avg_score    = avg;
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
    paint: { 'line-color': '#555', 'line-width': 0.4 }
  });

  // P1: now that provinces are live, cap countries to zoom 0–4 so they don't overlap.
  // This is intentionally deferred until here — if fetch/PIP fails, countries stay visible at all zooms.
  map.setLayerZoomRange('countries-fill', 0, 4);
  map.setLayerZoomRange('countries-line', 0, 4);

  map.on('click', 'world-provinces-fill', (e) => {
    const iso2 = e.features[0].properties.iso2;
    // P3: if this is a French province, trigger commune load (fire-and-forget)
    // and skip the province panel only when communes-fill is already rendered.
    if (iso2 === 'FR') {
      _loadFranceGeojson();
      if (map.getLayer('communes-fill')) return;
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
  });
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
