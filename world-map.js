import { colorFromScore } from './scoring.js';
import { renderWorldCityPanel, renderWorldCountryPanel, renderNoDataPanel } from './world-panel.js';
import { updatePanel } from './panel.js';
import { searchLocalCities, searchNominatim, escapeHtml } from './world-search.js';

const COUNTRIES_GEOJSON_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
const COMMUNES_GEOJSON_URL  = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson';

let map = null;
let worldCities = [];
let worldCountries = [];
let communesData = {};
let franceGeojson = null;
let _franceLoaded = false;
let _theme = localStorage.getItem('sca-theme') || 'dark';
let _searchTimer        = null;
let _lastNominatimQuery = '';

async function init() {
  // Load data
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
    // 1. Countries Layer
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

    // We will color countries after fetching GeoJSON
    fetch(COUNTRIES_GEOJSON_URL).then(r => r.json()).then(geo => {
      geo.features.forEach(f => {
        const iso = f.properties['ISO3166-1-Alpha-2'];
        const cData = countriesMap.get(iso);
        f.properties.color = colorFromScore(cData?.avg_score);
      });
      map.getSource('countries').setData(geo);
    });

    // 2. Cities Layer
    const citiesGeojson = {
      type: 'FeatureCollection',
      features: worldCities.map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        properties: { ...c, color: colorFromScore(c.score) }
      }))
    };
    
    map.addSource('cities', { type: 'geojson', data: citiesGeojson });
    map.addLayer({
      id: 'cities-circle',
      type: 'circle',
      source: 'cities',
      minzoom: 4,
      maxzoom: 7,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 7, 5],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 5, 1],
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff'
      }
    });

    // France BBox check
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
    });
    
    // Interactions
    map.on('click', 'countries-fill', (e) => {
      const iso = e.features[0].properties['ISO3166-1-Alpha-2'];
      const data = countriesMap.get(iso);
      if (data) {
        const topCities = worldCities.filter(c => c.country === iso && c.score != null).sort((a,b) => b.score - a.score).slice(0, 5);
        document.getElementById('panel-content').innerHTML = renderWorldCountryPanel(data, topCities);
        document.getElementById('panel-empty').hidden = true;
        document.getElementById('panel-content').hidden = false;
        
        if (iso === 'FR') {
          map.fitBounds([[-5.5, 41.0], [10.0, 51.5]], { padding: 20 });
          _loadFranceGeojson();
        }
      }
    });

    map.on('click', 'cities-circle', (e) => {
      const props = e.features[0].properties;
      props.params = JSON.parse(props.params); // Unpack
      document.getElementById('panel-content').innerHTML = renderWorldCityPanel(props);
      document.getElementById('panel-empty').hidden = true;
      document.getElementById('panel-content').hidden = false;
    });

    map.on('mouseenter', 'cities-circle', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const p     = e.features[0].properties;
      const score = p.score != null ? Math.round(p.score * 100) + ' %' : '—';
      const tip   = document.getElementById('map-tooltip');
      tip.textContent = `${p.name} — ${score}`;
      tip.style.display = 'block';
      tip.style.left    = (e.point.x + 14) + 'px';
      tip.style.top     = (e.point.y - 8)  + 'px';
    });

    map.on('mousemove', 'cities-circle', (e) => {
      const tip = document.getElementById('map-tooltip');
      tip.style.left = (e.point.x + 14) + 'px';
      tip.style.top  = (e.point.y - 8)  + 'px';
    });

    map.on('mouseleave', 'cities-circle', () => {
      map.getCanvas().style.cursor = '';
      document.getElementById('map-tooltip').style.display = 'none';
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

  // Fermer le dropdown si clic hors du champ
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
      'fill-opacity': 0.65
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

// Start
init();
