import { colorFromScore } from './scoring.js';
import { renderWorldCityPanel, renderWorldCountryPanel, renderNoDataPanel } from './world-panel.js';
import { updatePanel } from './panel.js';
import { searchLocalCities, searchNominatim, escapeHtml } from './world-search.js';

const COUNTRIES_GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
const COMMUNES_GEOJSON_URL  = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson';
const US_STATES_GEOJSON_URL = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';

let map = null;
let worldCities = [];
let worldCountries = [];
let communesData = {};
let franceGeojson = null;
let _franceLoaded = false;
let _usStatesLoaded = false;
let _usStatesMap = new Map(); // stateName → { avg_score, cities, scored_count }
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
      for (const c of list) {
        if (c.insee) communesData[c.insee] = c;
      }
    } else {
      communesData = list;
    }
  }

  const countriesMap = new Map(worldCountries.map(c => [c.iso2, c]));

  map = new maplibregl.Map({
    container: 'map',
    style: _theme === 'light' ? 'https://tiles.openfreemap.org/styles/positron' : 'https://tiles.openfreemap.org/styles/dark',
    center: [10, 20],
    zoom: 2,
    maxZoom: 16
  });

  map.on('load', async () => {
    // 1. Countries choropleth (always visible)
    map.addSource('countries', { type: 'geojson', data: COUNTRIES_GEOJSON_URL });
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
      maxzoom: 5,
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

    // 2. moveend: detect France and USA zones
    map.on('moveend', () => {
      const z = map.getZoom();
      const c = map.getCenter();

      const inFrance = z >= 7
        && c.lng > -5.5 && c.lng < 10.0
        && c.lat > 41.0 && c.lat < 51.5;

      const inUS = z >= 3
        && c.lng > -170 && c.lng < -60
        && c.lat > 15 && c.lat < 73;

      document.getElementById('btn-toggle-view').hidden = !inFrance;
      document.getElementById('search').placeholder = inFrance
        ? '🔍  Commune ou n° de dép...'
        : '🔍  Ville ou pays...';

      if (inFrance) _loadFranceGeojson();
      if (inUS) _loadUsStatesGeojson();
    });

    // 3. Country click — skip US when states are shown
    map.on('click', 'countries-fill', (e) => {
      const iso = e.features[0].properties['ISO3166-1-Alpha-2'];
      if (iso === 'US' && _usStatesLoaded && map.getZoom() >= 3) return;

      const data = countriesMap.get(iso);
      if (data) {
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
      }
    });
  });

  // Home Button
  document.getElementById('btn-home').addEventListener('click', () => {
    map.flyTo({ center: [10, 20], zoom: 2 });
  });

  // --- Recherche hybride ---
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
      'fill-opacity': 0.75
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

async function _loadUsStatesGeojson() {
  if (_usStatesLoaded) return;
  _usStatesLoaded = true;

  let r;
  try {
    r = await fetch(US_STATES_GEOJSON_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error('US States GeoJSON fetch failed:', e.message);
    _usStatesLoaded = false;
    return;
  }

  const geo = await r.json();
  const usCities = worldCities.filter(c => c.country === 'US');

  geo.features.forEach(f => {
    const cities = usCities.filter(c => _cityInPolygon(c.lng, c.lat, f));
    const scored = cities.filter(c => c.score != null);
    const avg = scored.length ? scored.reduce((s, c) => s + c.score, 0) / scored.length : null;
    f.properties.color = colorFromScore(avg);
    f.properties.avg_score = avg;
    f.properties.city_count = cities.length;
    f.properties.scored_count = scored.length;
    _usStatesMap.set(f.properties.name, { avg_score: avg, cities, scored_count: scored.length });
  });

  map.addSource('us-states', { type: 'geojson', data: geo });
  map.addLayer({
    id: 'us-states-fill',
    type: 'fill',
    source: 'us-states',
    minzoom: 3,
    paint: {
      'fill-color': ['coalesce', ['get', 'color'], 'rgba(0,0,0,0)'],
      'fill-opacity': 0.75
    }
  });
  map.addLayer({
    id: 'us-states-line',
    type: 'line',
    source: 'us-states',
    minzoom: 3,
    paint: { 'line-color': '#555', 'line-width': 0.5 }
  });

  map.on('click', 'us-states-fill', (e) => {
    const stateName = e.features[0].properties.name;
    const sd = _usStatesMap.get(stateName);
    if (!sd) return;
    const topCities = [...sd.cities]
      .filter(c => c.score != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    document.getElementById('panel-content').innerHTML = renderWorldCountryPanel(
      { name: stateName, avg_score: sd.avg_score, city_count: sd.cities.length, scored_count: sd.scored_count },
      topCities
    );
    document.getElementById('panel-empty').hidden = true;
    document.getElementById('panel-content').hidden = false;
  });
}

// Start
init();
