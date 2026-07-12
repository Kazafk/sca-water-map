import { colorFromScore } from './scoring.js';
import { renderWorldCityPanel, renderWorldCountryPanel, renderNoDataPanel } from './world-panel.js';
import { updatePanel } from './panel.js';
import { searchLocalCities, searchNominatim, escapeHtml } from './world-search.js';

const COUNTRIES_GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
const COMMUNES_GEOJSON_URL  = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson';
const PROVINCES_GEOJSON_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson';

// Layer architecture (bottom to top):
// countries-fill (maxzoom:4) → world-provinces-fill (minzoom:4) → communes-fill (minzoom:7, France only)

let map = null;
let worldCities = [];
let worldCountries = [];
let communesData = {};
let franceGeojson = null;
let _franceLoaded  = false;
let _provincesLoaded = false;
let _provincesData   = new Map(); // `${iso2}__${name}` → { avg_score, cities, scored_count, name }
let _citiesByCountry = new Map(); // iso2 → city[]
let _theme = localStorage.getItem('sca-theme') || 'dark';
let _searchTimer        = null;
let _lastNominatimQuery = '';

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

async function init() {
  const [citiesRes, countriesRes, communesRes] = await Promise.all([
    fetch('./world-cities.json'),
    fetch('./world-countries.json'),
    fetch('./communes.json')
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

  const countriesMap = new Map(worldCountries.map(c => [c.iso2, c]));
  if (frAvgScore != null) {
    const frEntry = countriesMap.get('FR') || {};
    countriesMap.set('FR', {
      ...frEntry,
      iso2: 'FR',
      name: 'France',
      avg_score: frAvgScore,
      city_count: communeScores.length,
      scored_count: communeScores.length
    });
  }

  // Group cities by country ISO2 for efficient province-level PIP
  for (const city of worldCities) {
    if (!_citiesByCountry.has(city.country)) _citiesByCountry.set(city.country, []);
    _citiesByCountry.get(city.country).push(city);
  }

  map = new maplibregl.Map({
    container: 'map',
    style: _theme === 'light'
      ? 'https://tiles.openfreemap.org/styles/positron'
      : 'https://tiles.openfreemap.org/styles/dark',
    center: [10, 20],
    zoom: 2,
    maxZoom: 16
  });

  map.on('load', async () => {
    // 1. Countries choropleth (zoom 0–4)
    map.addSource('countries', { type: 'geojson', data: COUNTRIES_GEOJSON_URL });
    map.addLayer({
      id: 'countries-fill',
      type: 'fill',
      source: 'countries',
      maxzoom: 4,
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
        'fill-opacity': 0.65
      }
    });
    map.addLayer({
      id: 'countries-line',
      type: 'line',
      source: 'countries',
      maxzoom: 4,
      paint: { 'line-color': '#444', 'line-width': 0.5 }
    });

    fetch(COUNTRIES_GEOJSON_URL).then(r => r.json()).then(geo => {
      geo.features.forEach(f => {
        const iso = f.properties['ISO3166-1-Alpha-2'];
        const cData = countriesMap.get(iso);
        f.properties.color = colorFromScore(cData?.avg_score);
      });
      map.getSource('countries').setData(geo);
    });

    // 2. moveend: lazy-load provinces at zoom 4+, communes at zoom 7+ in France
    map.on('moveend', () => {
      const z = map.getZoom();
      const c = map.getCenter();

      const inFrance = z >= 7
        && c.lng > -5.5 && c.lng < 10.0
        && c.lat > 41.0 && c.lat < 51.5;

      document.getElementById('btn-toggle-view').hidden = !inFrance;
      document.getElementById('search').placeholder = inFrance
        ? '🔍  Commune ou n° de dép...'
        : '🔍  Ville ou pays...';

      if (inFrance) _loadFranceGeojson();
      if (z >= 4) _loadWorldProvincesGeojson();
    });

    // 3. Country click → panel + optional France zoom
    map.on('click', 'countries-fill', (e) => {
      const iso = e.features[0].properties['ISO3166-1-Alpha-2'];
      const data = countriesMap.get(iso);
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

  geo.features.forEach(f => {
    // iso_3166_2 is like "US-CA", "FR-IDF", "DE-BY" — first 2 chars = country ISO2
    const raw = f.properties.iso_3166_2 || '';
    const iso2 = /^[A-Z]{2}/.test(raw) ? raw.substring(0, 2) : null;
    const candidates = (iso2 && _citiesByCountry.get(iso2)) || [];
    const cities  = candidates.filter(c => _cityInPolygon(c.lng, c.lat, f));
    const scored  = cities.filter(c => c.score != null);
    const avg     = scored.length ? scored.reduce((s, c) => s + c.score, 0) / scored.length : null;

    f.properties.color       = colorFromScore(avg);
    f.properties.avg_score   = avg;
    f.properties.city_count  = cities.length;
    f.properties.scored_count = scored.length;
    f.properties.iso2        = iso2;

    _provincesData.set(`${iso2}__${f.properties.name}`, {
      avg_score: avg, cities, scored_count: scored.length, name: f.properties.name
    });
  });

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

  map.on('click', 'world-provinces-fill', (e) => {
    // communes-fill is on top in France at zoom 7+ — its handler takes priority
    if (_franceLoaded && map.getZoom() >= 7) return;
    const iso2 = e.features[0].properties.iso2;
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

  map.addSource('communes', { type: 'geojson', data: franceGeojson });
  map.addLayer({
    id: 'communes-fill',
    type: 'fill',
    source: 'communes',
    minzoom: 7,
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.80
    }
  });
  map.addLayer({
    id: 'communes-line',
    type: 'line',
    source: 'communes',
    minzoom: 7,
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
