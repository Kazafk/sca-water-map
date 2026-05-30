import { colorFromScore } from './scoring.js';
import { updatePanel, updateDeptPanel } from './panel.js';

const COMMUNES_URL     = './communes.json';
const GEOJSON_URL      = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson';
const DEPT_GEOJSON_URL = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson';
const MAP_STYLE        = 'https://tiles.openfreemap.org/styles/dark';

let communesData = {};
let generatedAt  = null;
let totalScored  = 0;
let deptData     = {};
let map          = null;
let viewMode     = 'communes';

function _dept(insee) {
  return insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2);
}

function buildDeptData() {
  const d = {};
  for (const c of Object.values(communesData)) {
    const dept = _dept(c.insee);
    if (!d[dept]) d[dept] = { scores: [], communes: [] };
    d[dept].communes.push(c);
    if (c.score != null) d[dept].scores.push(c.score);
  }
  for (const info of Object.values(d)) {
    const n = info.scores.length;
    info.avgScore = n > 0 ? info.scores.reduce((a, b) => a + b, 0) / n : null;
    info.n = n;
  }
  return d;
}

function _applyViewMode() {
  if (!map || !map.isStyleLoaded()) return;
  const isC = viewMode === 'communes';
  for (const l of ['communes-fill', 'communes-line', 'communes-selected'])
    map.setLayoutProperty(l, 'visibility', isC ? 'visible' : 'none');
  for (const l of ['depts-fill', 'depts-line', 'depts-selected'])
    map.setLayoutProperty(l, 'visibility', isC ? 'none' : 'visible');
  document.getElementById('btn-toggle-view').textContent = isC ? '🗺 Depts' : '🏘 Communes';
}

async function init() {
  const [communesJson, geojson, deptGeojson] = await Promise.all([
    fetch(COMMUNES_URL).then(r => r.json()),
    fetch(GEOJSON_URL).then(r => r.json()),
    fetch(DEPT_GEOJSON_URL).then(r => r.json()),
  ]);

  generatedAt = communesJson.generated_at;
  totalScored = communesJson.total_scored ?? 0;
  for (const c of communesJson.communes) communesData[c.insee] = c;

  const d = new Date(generatedAt);
  document.getElementById('data-date').textContent =
    `Données Hub'Eau · ${d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;

  deptData = buildDeptData();

  for (const f of geojson.features) {
    const c = communesData[f.properties.code];
    f.properties.color = colorFromScore(c?.score ?? null);
  }
  for (const f of deptGeojson.features) {
    const info = deptData[f.properties.code];
    f.properties.color = colorFromScore(info?.avgScore ?? null);
  }

  map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: [2.35, 46.5],
    zoom: 5,
  });

  map.on('load', () => {
    // Communes
    map.addSource('communes', { type: 'geojson', data: geojson });
    map.addLayer({ id: 'communes-fill', type: 'fill', source: 'communes',
      paint: { 'fill-color': ['coalesce', ['get', 'color'], '#2d2d2d'], 'fill-opacity': 0.6 } });
    map.addLayer({ id: 'communes-line', type: 'line', source: 'communes',
      paint: { 'line-color': '#21262d', 'line-width': 0.3, 'line-opacity': 0.6 } });
    map.addLayer({ id: 'communes-selected', type: 'line', source: 'communes',
      filter: ['==', ['get', 'code'], ''],
      paint: { 'line-color': '#ffffff', 'line-width': 2 } });

    // Départements
    map.addSource('depts', { type: 'geojson', data: deptGeojson });
    map.addLayer({ id: 'depts-fill', type: 'fill', source: 'depts',
      layout: { visibility: 'none' },
      paint: { 'fill-color': ['coalesce', ['get', 'color'], '#2d2d2d'], 'fill-opacity': 0.7 } });
    map.addLayer({ id: 'depts-line', type: 'line', source: 'depts',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#21262d', 'line-width': 1 } });
    map.addLayer({ id: 'depts-selected', type: 'line', source: 'depts',
      filter: ['==', ['get', 'code'], ''], layout: { visibility: 'none' },
      paint: { 'line-color': '#ffffff', 'line-width': 2.5 } });

    // Tooltip survol
    const tooltip = document.getElementById('map-tooltip');

    map.on('mousemove', 'communes-fill', (e) => {
      const code = e.features[0]?.properties?.code;
      const c    = communesData[code];
      if (!c) return;
      const score = c.score != null ? `${Math.round(c.score * 100)} %` : '—';
      const col   = colorFromScore(c.score);
      tooltip.innerHTML = `<b>${c.nom}</b> <span style="color:${col}">${score}</span>`;
      tooltip.style.cssText = `display:block;left:${e.point.x + 14}px;top:${e.point.y - 8}px`;
    });
    map.on('mouseleave', 'communes-fill', () => { tooltip.style.display = 'none'; });

    map.on('mousemove', 'depts-fill', (e) => {
      const code = e.features[0]?.properties?.code ?? '';
      const nom  = e.features[0]?.properties?.nom  ?? '';
      const info = deptData[code];
      const score = info?.avgScore != null ? `${Math.round(info.avgScore * 100)} %` : '—';
      const col   = colorFromScore(info?.avgScore ?? null);
      tooltip.innerHTML = `<b>${nom} (${code})</b> <span style="color:${col}">${score} moy.</span>`;
      tooltip.style.cssText = `display:block;left:${e.point.x + 14}px;top:${e.point.y - 8}px`;
    });
    map.on('mouseleave', 'depts-fill', () => { tooltip.style.display = 'none'; });

    // Clics
    map.on('click', 'communes-fill', (e) => {
      const code    = e.features[0]?.properties?.code;
      const commune = communesData[code];
      if (!commune) return;
      map.setFilter('communes-selected', ['==', ['get', 'code'], code]);
      updatePanel(commune, generatedAt, totalScored);
    });

    map.on('click', 'depts-fill', (e) => {
      const code = e.features[0]?.properties?.code;
      const nom  = e.features[0]?.properties?.nom ?? '';
      if (!code) return;
      map.setFilter('depts-selected', ['==', ['get', 'code'], code]);
      updateDeptPanel(code, nom, deptData[code]);
    });

    // Curseurs
    for (const layer of ['communes-fill', 'depts-fill']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
  });

  // Toggle vue communes / départements
  document.getElementById('btn-toggle-view').addEventListener('click', () => {
    viewMode = viewMode === 'communes' ? 'depts' : 'communes';
    _applyViewMode();
  });

  // Géolocalisation
  document.getElementById('btn-locate').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('Géolocalisation non supportée.'); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (viewMode !== 'communes') { viewMode = 'communes'; _applyViewMode(); }
      map.flyTo({ center: [coords.longitude, coords.latitude], zoom: 12 });
      map.once('moveend', () => {
        const pt       = map.project([coords.longitude, coords.latitude]);
        const features = map.queryRenderedFeatures(pt, { layers: ['communes-fill'] });
        const code     = features[0]?.properties?.code;
        const commune  = communesData[code];
        if (commune) {
          map.setFilter('communes-selected', ['==', ['get', 'code'], code]);
          updatePanel(commune, generatedAt, totalScored);
        }
      });
    }, () => alert('Géolocalisation refusée ou indisponible.'));
  });

  // Recherche (commune ou n° de département)
  const searchEl = document.getElementById('search');
  let dropdown   = null;

  function closeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
  }

  function selectCommune(commune) {
    searchEl.value = commune.nom;
    closeDropdown();
    if (viewMode !== 'communes') { viewMode = 'communes'; _applyViewMode(); }
    if (map?.isStyleLoaded())
      map.setFilter('communes-selected', ['==', ['get', 'code'], commune.insee]);
    updatePanel(commune, generatedAt, totalScored);
  }

  searchEl.addEventListener('input', () => {
    closeDropdown();
    const q = searchEl.value.trim().toLowerCase();
    if (q.length < 2) return;

    let matches;
    if (/^\d{2,3}$/.test(q)) {
      const pad = q.padStart(2, '0');
      matches = Object.values(communesData)
        .filter(c => _dept(c.insee) === pad || _dept(c.insee) === q)
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        .slice(0, 8);
    } else {
      matches = Object.values(communesData)
        .filter(c => c.nom.toLowerCase().includes(q))
        .slice(0, 8);
    }
    if (!matches.length) return;

    dropdown = document.createElement('ul');
    dropdown.className = 'search-dropdown';
    for (const commune of matches) {
      const li    = document.createElement('li');
      const score = commune.score != null ? ` — ${Math.round(commune.score * 100)} %` : '';
      const col   = colorFromScore(commune.score);
      li.innerHTML = `${commune.nom}<span style="color:${col};float:right">${score}</span>`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); selectCommune(commune); });
      dropdown.appendChild(li);
    }
    document.getElementById('search-wrapper').appendChild(dropdown);
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('search-wrapper').contains(e.target)) closeDropdown();
  });
}

init().catch(err => {
  console.error('Init failed:', err);
  document.getElementById('data-date').textContent = 'Erreur de chargement';
});
