// public/map.js
import { colorFromScore } from './scoring.js';
import { updatePanel    } from './panel.js';

const COMMUNES_URL = './communes.json';
const GEOJSON_URL  = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes.geojson';
const MAP_STYLE    = 'https://tiles.openfreemap.org/styles/dark';

let communesData = {};
let generatedAt  = null;
let totalScored  = 0;
let map          = null;

async function init() {
  const [communesJson, geojson] = await Promise.all([
    fetch(COMMUNES_URL).then(r => r.json()),
    fetch(GEOJSON_URL).then(r  => r.json()),
  ]);

  generatedAt = communesJson.generated_at;
  totalScored  = communesJson.total_scored ?? 0;

  for (const c of communesJson.communes) {
    communesData[c.insee] = c;
  }

  // Update date badge
  const d = new Date(generatedAt);
  document.getElementById('data-date').textContent =
    `Données Hub'Eau · ${d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;

  // Embed score colour into each GeoJSON feature for MapLibre paint
  for (const f of geojson.features) {
    const commune = communesData[f.properties.code];
    f.properties.color = colorFromScore(commune?.score ?? null);
  }

  map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: [2.35, 46.5],
    zoom: 5,
  });

  map.on('load', () => {
    map.addSource('communes', { type: 'geojson', data: geojson });

    map.addLayer({
      id: 'communes-fill',
      type: 'fill',
      source: 'communes',
      paint: {
        'fill-color':   ['coalesce', ['get', 'color'], '#2d2d2d'],
        'fill-opacity': 0.6,
      },
    });

    map.addLayer({
      id: 'communes-line',
      type: 'line',
      source: 'communes',
      paint: { 'line-color': '#21262d', 'line-width': 0.3, 'line-opacity': 0.6 },
    });

    // Highlight layer — initially matches nothing
    map.addLayer({
      id: 'communes-selected',
      type: 'line',
      source: 'communes',
      filter: ['==', ['get', 'code'], ''],
      paint: { 'line-color': '#ffffff', 'line-width': 2 },
    });

    map.on('click', 'communes-fill', (e) => {
      const code    = e.features[0]?.properties?.code;
      const commune = communesData[code];
      if (!commune) return;
      map.setFilter('communes-selected', ['==', ['get', 'code'], code]);
      updatePanel(commune, generatedAt, totalScored);
    });

    map.on('mouseenter', 'communes-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'communes-fill', () => { map.getCanvas().style.cursor = ''; });
  });

  // Search with dropdown suggestions
  const searchEl = document.getElementById('search');
  let dropdown   = null;

  function closeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
  }

  function selectCommune(commune) {
    searchEl.value = commune.nom;
    closeDropdown();
    if (map && map.getLayer('communes-selected')) {
      map.setFilter('communes-selected', ['==', ['get', 'code'], commune.insee]);
    }
    updatePanel(commune, generatedAt, totalScored);
  }

  searchEl.addEventListener('input', () => {
    closeDropdown();
    const q = searchEl.value.trim().toLowerCase();
    if (q.length < 2) return;

    const matches = Object.values(communesData)
      .filter(c => c.nom.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) return;

    dropdown = document.createElement('ul');
    dropdown.className = 'search-dropdown';
    for (const commune of matches) {
      const li = document.createElement('li');
      li.textContent = commune.nom;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); selectCommune(commune); });
      dropdown.appendChild(li);
    }
    document.getElementById('search-wrapper').appendChild(dropdown);
  });

  const searchWrapper = document.getElementById('search-wrapper');
  document.addEventListener('click', (e) => {
    if (!searchWrapper.contains(e.target)) closeDropdown();
  });
}

init().catch(err => {
  console.error('Init failed:', err);
  document.getElementById('data-date').textContent = 'Erreur de chargement';
});
