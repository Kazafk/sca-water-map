import { colorFromScore, cappedScore } from './scoring.js';
import { updatePanel, updateDeptPanel, updateComparePanel, showComparePending } from './panel.js';
import { initBottomSheet } from './sheet.js';

const COMMUNES_URL     = './communes.json';
const GEOJSON_URL      = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson';
const DEPT_GEOJSON_URL = 'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson';
const DARK_MAP_STYLE   = 'https://tiles.openfreemap.org/styles/dark';
const LIGHT_MAP_STYLE  = 'https://tiles.openfreemap.org/styles/positron';
const HISTORY_KEY      = 'sca-history';
const HISTORY_MAX      = 8;

const LABEL_MIN_ZOOM = {
  '75056':6,'13055':6,'69123':6,'31555':6,'06088':6,'44109':6,'34172':6,
  '67482':6,'33063':6,'59350':6,'35238':6,'51454':6,'76351':6,'42218':6,
  '83137':6,'38185':6,'21231':6,'49007':6,'30189':6,'63113':6,'87085':6,
  '66136':6,'57463':6,'25056':6,'45234':6,'76540':6,'14118':6,'54395':6,
  '86194':6,'84007':6,'29019':6,'37261':6,'72181':6,'68224':6,'80021':6,
  '13001':6,'69266':6,'95018':6,'92012':6,'93048':6,'59599':6,'59512':6,
  '59183':6,'74010':6,'73065':6,'64445':6,'62193':6,'56121':6,'97105':6,
  '97209':6,'97408':6,
  '62041':8,'02691':8,'10387':8,'51108':8,'88160':8,'90010':8,'39300':8,
  '01053':8,'68066':8,'71270':8,'71076':8,'89024':8,'58194':8,'03190':8,
  '82121':8,'81004':8,'12202':8,'46042':8,'19031':8,'24322':8,'47001':8,
  '40192':8,'65440':8,'32013':8,'09122':8,'11069':8,'34032':8,'06029':8,
  '06004':8,'78646':8,'94028':8,'92050':8,'77288':8,'77152':8,'28085':8,
  '53130':8,'61001':8,'50129':8,'27229':8,'60057':8,'08105':8,'55029':8,
  '26362':8,'07186':8,'43157':8,'15014':8,'48095':8,'04070':8,'05061':8,
  '83050':8,'93066':8,'92025':8,'94080':8,'91228':8,'95127':8,
};

const ARR_PARENT = {};
for (let i = 1; i <= 20; i++) ARR_PARENT[`751${String(i).padStart(2,'0')}`] = '75056';
for (let i = 1; i <= 9;  i++) ARR_PARENT[`6938${i}`]                        = '69123';
for (let i = 1; i <= 16; i++) ARR_PARENT[`132${String(i).padStart(2,'0')}`] = '13055';

// Score → color per theme
const THEME_COLORS = {
  dark:  { noData: '#2d2d2d', ideal: '#2ecc71', ok: '#3498db', warn: '#f39c12', bad: '#e74c3c' },
  light: { noData: '#d0c4b8', ideal: '#5a9e5a', ok: '#4a80c0', warn: '#c87020', bad: '#c03030' },
};

function _colorForTheme(score, theme) {
  const C = THEME_COLORS[theme] ?? THEME_COLORS.dark;
  if (score == null) return C.noData;
  if (score >= 0.75) return C.ideal;
  if (score >= 0.50) return C.ok;
  if (score >= 0.25) return C.warn;
  return C.bad;
}

let communesData  = {};
let arrData       = {};
let generatedAt   = null;
let totalScored   = 0;
let deptData      = {};
let map           = null;
let viewMode      = 'communes';
let sheet         = null;
let compareMode   = false;
let compareBase   = null;
let showBottled   = false;
let activeCommune = null;
let activeTab          = 'params';
let selectedSandreCode = null;
let _rawDataCache      = {};
let _paramCache        = {};
let _geojson      = null;
let _deptGeojson  = null;
let _theme        = localStorage.getItem('sca-theme') || 'dark';
let _mapInitialized = false;

// --- Hub'Eau raw data fetch ---

async function _fetchRawData(insee) {
  if (_rawDataCache[insee]) return _rawDataCache[insee];
  try {
    const url = `https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/resultats_dis?code_commune_insee=${insee}&size=200`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _rawDataCache[insee] = data;
    return data;
  } catch (e) {
    return { error: e.message, data: [], count: 0 };
  }
}

async function _fetchParamData(insee, code) {
  const key = `${insee}_${code}`;
  if (_paramCache[key]) return _paramCache[key];
  try {
    const since = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const url = `https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/resultats_dis?code_commune_insee=${insee}&code_parametre=${code}&size=200&date_min_prelevement=${since}&sort=date_prelevement&order=asc`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _paramCache[key] = data;
    return data;
  } catch (e) {
    return { error: e.message, data: [], count: 0 };
  }
}

// --- History ---

function _saveHistory(commune) {
  let h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  h = [commune.insee, ...h.filter(c => c !== commune.insee)].slice(0, HISTORY_MAX);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}

function _renderHistory() {
  const emptyEl = document.getElementById('panel-empty');
  const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    .map(ins => communesData[ins] ?? arrData[ins]).filter(Boolean);
  if (!history.length) {
    emptyEl.innerHTML = 'Cliquez sur une commune pour voir le détail';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.innerHTML = `
    <div style="padding:16px 14px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:10px">Récemment consultées</div>
      ${history.map(c => {
        const cs    = cappedScore(c.score, c.params);
        const col   = colorFromScore(cs);
        const score = cs != null ? Math.round(cs * 100) + ' %' : '—';
        return `<div class="history-row" data-insee="${c.insee}">
          <span class="history-nom">${c.nom}</span>
          <span style="color:${col};font-size:10px">${score}</span>
        </div>`;
      }).join('')}
    </div>`;
  emptyEl.hidden = false;
  emptyEl.querySelectorAll('.history-row').forEach(row => {
    row.addEventListener('click', () => {
      const c = communesData[row.dataset.insee] ?? arrData[row.dataset.insee];
      if (c) selectCommune(c);
    });
  });
}

// --- Theme ---

function _updateGeoColors() {
  if (!_geojson || !_deptGeojson) return;
  for (const f of _geojson.features) {
    const code = f.properties.code;
    const c    = communesData[code] ?? arrData[code] ?? null;
    f.properties.color = _colorForTheme(cappedScore(c?.score ?? null, c?.params), _theme);
  }
  for (const f of _deptGeojson.features) {
    const info = deptData[f.properties.code];
    f.properties.color = _colorForTheme(info?.avgScore ?? null, _theme);
  }
  if (map?.getSource('communes')) map.getSource('communes').setData(_geojson);
  if (map?.getSource('depts'))    map.getSource('depts').setData(_deptGeojson);
}

// Met à jour les propriétés de rendu des layers sans les recréer
function _applyThemePaint() {
  const light       = _theme === 'light';
  const lineColor   = light ? '#c8b090' : '#21262d';
  const noDataColor = light ? '#d0c4b8' : '#2d2d2d';
  const textColor   = light ? '#3d2810' : '#e8edf3';
  const textHalo    = light ? 'rgba(245,237,224,0.9)' : 'rgba(13,17,23,0.88)';
  const selColor    = light ? '#3d2810' : '#ffffff';
  const s = (layer, prop, val) => { try { map.setPaintProperty(layer, prop, val); } catch (_) {} };
  s('communes-fill',     'fill-color',      ['coalesce', ['get', 'color'], noDataColor]);
  s('communes-line',     'line-color',      lineColor);
  s('communes-selected', 'line-color',      selColor);
  s('communes-labels',   'text-color',      textColor);
  s('communes-labels',   'text-halo-color', textHalo);
  s('depts-fill',        'fill-color',      ['coalesce', ['get', 'color'], noDataColor]);
  s('depts-line',        'line-color',      lineColor);
  s('depts-selected',    'line-color',      selColor);
  s('depts-labels',      'text-color',      textColor);
  s('depts-labels',      'text-halo-color', textHalo);
}

function _toggleTheme() {
  _theme = _theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('sca-theme', _theme);
  document.body.dataset.theme = _theme === 'light' ? 'light' : '';
  document.getElementById('btn-theme').textContent = _theme === 'light' ? '🌙' : '☀';

  // Mettre à jour les couleurs GeoJSON en mémoire avant le changement de style
  _updateGeoColors();

  const customLayerIds = ['communes-fill','communes-line','communes-selected','communes-labels',
                          'depts-fill','depts-line','depts-selected','depts-labels'];

  // transformStyle préserve nos sources et layers custom pendant le swap de style de fond.
  // Évite totalement le problème de timing remove/re-add après style.load.
  map.setStyle(_theme === 'light' ? LIGHT_MAP_STYLE : DARK_MAP_STYLE, {
    transformStyle: (prev, next) => {
      if (!prev) return next;
      const keepSources = {};
      for (const id of ['communes', 'depts']) {
        if (prev.sources?.[id]) keepSources[id] = prev.sources[id];
      }
      const keepLayers = (prev.layers ?? []).filter(l => customLayerIds.includes(l.id));
      return {
        ...next,
        sources: { ...next.sources, ...keepSources },
        layers:  [...next.layers, ...keepLayers],
      };
    },
  });

  map.once('style.load', () => {
    if (map.getLayer('communes-fill')) {
      // Cas nominal : transformStyle a préservé les layers
      // Mettre à jour les données source (nouvelles couleurs thème) et les propriétés de peinture
      if (map.getSource('communes')) map.getSource('communes').setData(_geojson);
      if (map.getSource('depts'))    map.getSource('depts').setData(_deptGeojson);
      _applyThemePaint();
    } else {
      // Fallback : transformStyle n'a pas fonctionné, recréer les layers
      _setupMapLayers();
    }
    _applyViewMode();
    if (activeCommune)
      map.setFilter('communes-selected', ['==', ['get', 'code'], activeCommune.insee]);
  });
}

// --- URL state ---

function _pushState(commune) {
  const url = new URL(location.href);
  url.searchParams.set('commune', commune.insee);
  url.searchParams.delete('dept');
  history.pushState({ commune: commune.insee }, '', url);
}

function _pushStateDept(code) {
  const url = new URL(location.href);
  url.searchParams.set('dept', code);
  url.searchParams.delete('commune');
  history.pushState({ dept: code }, '', url);
}

// --- Helpers ---

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
  for (const l of ['communes-fill', 'communes-line', 'communes-selected', 'communes-labels'])
    map.setLayoutProperty(l, 'visibility', isC ? 'visible' : 'none');
  for (const l of ['depts-fill', 'depts-line', 'depts-selected', 'depts-labels'])
    map.setLayoutProperty(l, 'visibility', isC ? 'none' : 'visible');
  document.getElementById('btn-toggle-view').textContent = isC ? '🗺 Depts' : '🏘 Communes';
}

// --- Map layer setup (called on every style.load) ---

function _setupMapLayers() {
  // Guard: remove any stale layers/sources that may still exist after setStyle()
  const layerIds = ['communes-labels','communes-selected','communes-line','communes-fill',
                    'depts-labels','depts-selected','depts-line','depts-fill'];
  for (const id of layerIds) { try { if (map.getLayer(id))  map.removeLayer(id);  } catch (_) {} }
  for (const id of ['communes','depts']) { try { if (map.getSource(id)) map.removeSource(id); } catch (_) {} }

  const light       = _theme === 'light';
  const lineColor   = light ? '#c8b090' : '#21262d';
  const noDataColor = light ? '#d0c4b8' : '#2d2d2d';
  const textColor   = light ? '#3d2810' : '#e8edf3';
  const textHalo    = light ? 'rgba(245,237,224,0.9)' : 'rgba(13,17,23,0.88)';
  const selColor    = light ? '#3d2810' : '#ffffff';

  map.addSource('communes', { type: 'geojson', data: _geojson });
  map.addLayer({ id: 'communes-fill', type: 'fill', source: 'communes',
    paint: { 'fill-color': ['coalesce', ['get', 'color'], noDataColor], 'fill-opacity': 0.65 } });
  map.addLayer({ id: 'communes-line', type: 'line', source: 'communes',
    paint: { 'line-color': lineColor, 'line-width': 0.3, 'line-opacity': 0.7 } });
  map.addLayer({ id: 'communes-selected', type: 'line', source: 'communes',
    filter: ['==', ['get', 'code'], ''],
    paint: { 'line-color': selColor, 'line-width': 2.5 } });
  map.addLayer({ id: 'communes-labels', type: 'symbol', source: 'communes', minzoom: 6,
    layout: {
      'text-field':         ['get', 'nom'],
      'text-font':          ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-size':          ['interpolate', ['linear'], ['zoom'], 6, 9, 9, 10, 12, 12],
      'text-anchor':        'center',
      'text-max-width':     8,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color':      textColor,
      'text-halo-color': textHalo,
      'text-halo-width': 1.5,
      'text-opacity':    ['case', ['>=', ['zoom'], ['get', 'label_min_zoom']], 1, 0],
    },
  });

  map.addSource('depts', { type: 'geojson', data: _deptGeojson });
  map.addLayer({ id: 'depts-fill', type: 'fill', source: 'depts',
    layout: { visibility: 'none' },
    paint: { 'fill-color': ['coalesce', ['get', 'color'], noDataColor], 'fill-opacity': 0.7 } });
  map.addLayer({ id: 'depts-line', type: 'line', source: 'depts',
    layout: { visibility: 'none' },
    paint: { 'line-color': lineColor, 'line-width': 1 } });
  map.addLayer({ id: 'depts-selected', type: 'line', source: 'depts',
    filter: ['==', ['get', 'code'], ''], layout: { visibility: 'none' },
    paint: { 'line-color': selColor, 'line-width': 2.5 } });
  map.addLayer({ id: 'depts-labels', type: 'symbol', source: 'depts', minzoom: 5,
    layout: {
      visibility:           'none',
      'text-field':         ['get', 'nom'],
      'text-font':          ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-size':          ['interpolate', ['linear'], ['zoom'], 5, 10, 8, 13],
      'text-anchor':        'center',
      'text-max-width':     10,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color':      textColor,
      'text-halo-color': textHalo,
      'text-halo-width': 2,
    },
  });
}

// --- Commune selection ---

function _deselectCommune() {
  activeCommune  = null;
  showBottled    = false;
  searchEl.value = '';
  closeDropdown();
  if (map?.isStyleLoaded())
    map.setFilter('communes-selected', ['==', ['get', 'code'], '']);
  const url = new URL(location.href);
  url.searchParams.delete('commune');
  history.pushState({}, '', url);
  document.getElementById('panel-content').hidden = true;
  document.getElementById('panel-empty').hidden   = false;
  _renderHistory();
  sheet?.peek?.();
}

function selectCommune(commune) {
  if (compareMode) {
    compareMode = false;
    updateComparePanel(compareBase, commune, generatedAt);
    compareBase = null;
    sheet?.open();
    return;
  }

  activeCommune      = commune;
  activeTab          = 'params';
  selectedSandreCode = null;
  showBottled        = false;
  // Keep _paramCache and _rawDataCache — they're keyed by INSEE and persist across communes
  searchEl.value = commune.nom;
  closeDropdown();
  if (viewMode !== 'communes') { viewMode = 'communes'; _applyViewMode(); }
  if (map?.isStyleLoaded())
    map.setFilter('communes-selected', ['==', ['get', 'code'], commune.insee]);
  _saveHistory(commune);
  _pushState(commune);
  sheet?.open();
  updatePanel(commune, generatedAt, totalScored, { showBottled, activeTab });
}

// --- Search ---

let searchEl;
let dropdown      = null;
let dropdownIndex = -1;

function closeDropdown() {
  if (dropdown) { dropdown.remove(); dropdown = null; }
  dropdownIndex = -1;
}

function _buildDropdown(matches) {
  closeDropdown();
  if (!matches.length) return;
  dropdown = document.createElement('ul');
  dropdown.className = 'search-dropdown';
  for (const commune of matches) {
    const li    = document.createElement('li');
    const score = commune.score != null ? ` — ${Math.round(commune.score * 100)} %` : '';
    const col   = colorFromScore(commune.score);
    li.innerHTML = `${commune.nom}<span style="color:${col};float:right">${score}</span>`;
    li.dataset.insee = commune.insee;
    li.addEventListener('mousedown', (e) => { e.preventDefault(); selectCommune(commune); });
    dropdown.appendChild(li);
  }
  document.getElementById('search-wrapper').appendChild(dropdown);
}

// --- Onboarding ---

function _initOnboarding() {
  if (localStorage.getItem('sca-onboarded')) return;
  const overlay = document.getElementById('onboarding-overlay');
  const modal   = document.getElementById('onboarding-modal');
  overlay.hidden = false;
  modal.hidden   = false;

  function close() {
    overlay.hidden = true;
    modal.hidden   = true;
    localStorage.setItem('sca-onboarded', '1');
  }

  document.getElementById('btn-onboarding-close').addEventListener('click', close);
  overlay.addEventListener('click', close);
}

// --- Init ---

async function init() {
  const [communesJson, geojson, deptGeojson] = await Promise.all([
    fetch(COMMUNES_URL).then(r => r.json()),
    fetch(GEOJSON_URL).then(r => r.json()),
    fetch(DEPT_GEOJSON_URL).then(r => r.json()),
  ]);

  _geojson     = geojson;
  _deptGeojson = deptGeojson;
  generatedAt  = communesJson.generated_at;
  totalScored  = communesJson.total_scored ?? 0;
  for (const c of communesJson.communes) communesData[c.insee] = c;

  for (const [arr, parent] of Object.entries(ARR_PARENT)) {
    if (communesData[parent]) arrData[arr] = { ...communesData[parent], insee: arr };
  }

  const d = new Date(generatedAt);
  document.getElementById('data-date').textContent =
    `Données Hub'Eau · ${d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;

  deptData = buildDeptData();

  if (window.matchMedia('(max-width: 768px)').matches) {
    sheet = initBottomSheet(document.getElementById('panel'));
  }

  _initOnboarding();

  // Apply saved theme on load
  if (_theme === 'light') {
    document.body.dataset.theme = 'light';
    document.getElementById('btn-theme').textContent = '🌙';
  }

  for (const f of _geojson.features) {
    const code   = f.properties.code;
    const parent = ARR_PARENT[code];
    if (parent && arrData[code]) arrData[code].nom = f.properties.nom;
    const c = communesData[code] ?? arrData[code] ?? null;
    f.properties.color          = _colorForTheme(cappedScore(c?.score ?? null, c?.params), _theme);
    f.properties.label_min_zoom = LABEL_MIN_ZOOM[parent ?? code] ?? 11;
  }
  for (const f of _deptGeojson.features) {
    const info = deptData[f.properties.code];
    f.properties.color = _colorForTheme(info?.avgScore ?? null, _theme);
  }

  map = new maplibregl.Map({
    container: 'map',
    style:     _theme === 'light' ? LIGHT_MAP_STYLE : DARK_MAP_STYLE,
    center:    [2.35, 46.5],
    zoom:      5,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  // Initial layer setup on first load
  map.on('load', () => {
    _setupMapLayers();
    _applyViewMode();

    if (!_mapInitialized) {
      _mapInitialized = true;
      // URL restore
      const params      = new URLSearchParams(location.search);
      const initCommune = params.get('commune');
      const initDept    = params.get('dept');
      if (initCommune) {
        const c = communesData[initCommune] ?? arrData[initCommune];
        if (c) {
          map.setFilter('communes-selected', ['==', ['get', 'code'], c.insee]);
          updatePanel(c, generatedAt, totalScored);
          activeCommune = c;
          map.flyTo({ center: _communeCenter(initCommune), zoom: 11, animate: false });
        }
      } else if (initDept) {
        viewMode = 'depts';
        _applyViewMode();
        const deptFeature = _deptGeojson.features.find(f => f.properties.code === initDept);
        if (deptFeature) {
          map.setFilter('depts-selected', ['==', ['get', 'code'], initDept]);
          updateDeptPanel(initDept, deptFeature.properties.nom, deptData[initDept]);
        }
      } else {
        _renderHistory();
      }
    }
  });

  // Layer event handlers — registered once on map instance
  const tooltip = document.getElementById('map-tooltip');

  map.on('mousemove', 'communes-fill', (e) => {
    const code = e.features[0]?.properties?.code;
    const c    = communesData[code];
    if (!c) return;
    const cs    = cappedScore(c.score, c.params);
    const score = cs != null ? `${Math.round(cs * 100)} %` : '—';
    const col   = colorFromScore(cs);
    tooltip.innerHTML = `<b>${c.nom}</b> <span style="color:${col}">${score}</span>`;
    tooltip.style.cssText = `display:block;left:${e.point.x + 14}px;top:${e.point.y - 8}px`;
  });
  map.on('mouseleave', 'communes-fill', () => { tooltip.style.display = 'none'; });

  map.on('mousemove', 'depts-fill', (e) => {
    const code  = e.features[0]?.properties?.code ?? '';
    const nom   = e.features[0]?.properties?.nom  ?? '';
    const info  = deptData[code];
    const score = info?.avgScore != null ? `${Math.round(info.avgScore * 100)} %` : '—';
    const col   = colorFromScore(info?.avgScore ?? null);
    tooltip.innerHTML = `<b>${nom} (${code})</b> <span style="color:${col}">${score} moy.</span>`;
    tooltip.style.cssText = `display:block;left:${e.point.x + 14}px;top:${e.point.y - 8}px`;
  });
  map.on('mouseleave', 'depts-fill', () => { tooltip.style.display = 'none'; });

  map.on('click', 'communes-fill', (e) => {
    const code    = e.features[0]?.properties?.code;
    const commune = communesData[code] ?? arrData[code];
    if (!commune) return;
    if (activeCommune?.insee === commune.insee) { _deselectCommune(); return; }
    map.setFilter('communes-selected', ['==', ['get', 'code'], code]);
    selectCommune(commune);
  });

  map.on('click', 'depts-fill', (e) => {
    const code = e.features[0]?.properties?.code;
    const nom  = e.features[0]?.properties?.nom ?? '';
    if (!code) return;
    map.setFilter('depts-selected', ['==', ['get', 'code'], code]);
    _pushStateDept(code);
    sheet?.open();
    updateDeptPanel(code, nom, deptData[code]);
  });

  for (const layer of ['communes-fill', 'depts-fill']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }

  // Theme toggle
  document.getElementById('btn-theme').addEventListener('click', _toggleTheme);

  // Toggle view
  document.getElementById('btn-toggle-view').addEventListener('click', () => {
    viewMode = viewMode === 'communes' ? 'depts' : 'communes';
    _applyViewMode();
  });

  // Home
  document.getElementById('btn-home').addEventListener('click', () => {
    map.flyTo({ center: [2.35, 46.5], zoom: 5 });
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
        const commune  = communesData[code] ?? arrData[code];
        if (commune) {
          map.setFilter('communes-selected', ['==', ['get', 'code'], code]);
          selectCommune(commune);
        }
      });
    }, () => alert('Géolocalisation refusée ou indisponible.'));
  });

  // Panel delegation
  document.getElementById('panel-content').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset?.action;
    if (!action) return;

    if (action === 'switch-tab' && activeCommune) {
      const tab = e.target.closest('[data-tab]')?.dataset?.tab;
      if (!tab) return;
      activeTab = tab;
      if (tab === 'data') {
        const insee = activeCommune.insee;
        updatePanel(activeCommune, generatedAt, totalScored, { showBottled, activeTab: 'data', rawData: null, selectedCode: selectedSandreCode });
        _fetchRawData(insee).then(rawData => {
          if (activeTab !== 'data' || !activeCommune || activeCommune.insee !== insee) return;
          // Determine which code will be auto-selected (first priority code with data)
          const PRIORITY_CODES = ['1374','1347','1302','1350','1375','1337','1335','1303'];
          const items = rawData?.data ?? [];
          const firstCode = selectedSandreCode ?? PRIORITY_CODES.find(c =>
            items.some(r => r.code_parametre === c && r.resultat_numerique != null)
          ) ?? null;
          if (firstCode && !selectedSandreCode) selectedSandreCode = firstCode;
          const pKey = firstCode ? `${insee}_${firstCode}` : null;
          const pCached = pKey ? (_paramCache[pKey] ?? null) : null;
          updatePanel(activeCommune, generatedAt, totalScored, {
            showBottled, activeTab: 'data', rawData,
            selectedCode: selectedSandreCode,
            paramData: firstCode ? (pCached ?? 'loading') : null,
          });
          if (firstCode && !pCached) {
            _fetchParamData(insee, firstCode).then(pdata => {
              if (activeTab === 'data' && activeCommune?.insee === insee && selectedSandreCode === firstCode)
                updatePanel(activeCommune, generatedAt, totalScored, {
                  showBottled, activeTab: 'data', rawData,
                  selectedCode: firstCode, paramData: pdata,
                });
            });
          }
        });
      } else {
        updatePanel(activeCommune, generatedAt, totalScored, { showBottled, activeTab });
      }
    } else if (action === 'select-season-param' && activeCommune) {
      const code = e.target.closest('[data-code]')?.dataset?.code;
      if (code) {
        selectedSandreCode = code;
        const insee  = activeCommune.insee;
        const cached = _rawDataCache[insee] ?? null;
        const pKey   = `${insee}_${code}`;
        const pCached = _paramCache[pKey] ?? null;
        // Show immediately with existing data (or loading state for chart)
        updatePanel(activeCommune, generatedAt, totalScored, {
          showBottled, activeTab: 'data', rawData: cached, selectedCode: code,
          paramData: pCached ?? 'loading',
        });
        if (!pCached) {
          _fetchParamData(insee, code).then(pdata => {
            if (activeTab === 'data' && activeCommune?.insee === insee && selectedSandreCode === code)
              updatePanel(activeCommune, generatedAt, totalScored, {
                showBottled, activeTab: 'data', rawData: cached, selectedCode: code, paramData: pdata,
              });
          });
        }
      }
    } else if (action === 'compare' && activeCommune) {
      compareMode = true;
      compareBase = activeCommune;
      showComparePending(activeCommune);
    } else if (action === 'close-compare') {
      compareMode = false;
      compareBase = null;
      if (activeCommune) {
        updatePanel(activeCommune, generatedAt, totalScored, { showBottled, activeTab, selectedCode: selectedSandreCode });
      } else {
        document.getElementById('panel-content').hidden = true;
        document.getElementById('panel-empty').hidden   = false;
        _renderHistory();
      }
    } else if (action === 'toggle-bottled' && activeCommune) {
      showBottled = !showBottled;
      updatePanel(activeCommune, generatedAt, totalScored, { showBottled, activeTab, selectedCode: selectedSandreCode });
    } else if (action === 'select-commune') {
      const ins = e.target.closest('[data-insee]')?.dataset?.insee;
      const c   = communesData[ins] ?? arrData[ins];
      if (c) selectCommune(c);
    }
  });

  // Search
  searchEl = document.getElementById('search');

  searchEl.addEventListener('input', () => {
    const q = searchEl.value.trim().toLowerCase();
    if (q.length < 2) { closeDropdown(); return; }

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
    _buildDropdown(matches);
  });

  searchEl.addEventListener('keydown', (e) => {
    if (!dropdown) {
      if (e.key === 'Escape') searchEl.blur();
      return;
    }
    const items = dropdown.querySelectorAll('li');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      dropdownIndex = Math.min(dropdownIndex + 1, items.length - 1);
      items.forEach((li, i) => li.classList.toggle('active', i === dropdownIndex));
      items[dropdownIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      dropdownIndex = Math.max(dropdownIndex - 1, 0);
      items.forEach((li, i) => li.classList.toggle('active', i === dropdownIndex));
      items[dropdownIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (dropdownIndex >= 0 && items[dropdownIndex]) {
        const ins = items[dropdownIndex].dataset.insee;
        const c   = communesData[ins];
        if (c) selectCommune(c);
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
      searchEl.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('search-wrapper').contains(e.target)) closeDropdown();
  });

  window.addEventListener('popstate', (e) => {
    const st = e.state;
    if (st?.commune) {
      const c = communesData[st.commune] ?? arrData[st.commune];
      if (c) {
        activeCommune = c;
        showBottled   = false;
        map.setFilter('communes-selected', ['==', ['get', 'code'], c.insee]);
        updatePanel(c, generatedAt, totalScored);
      }
    } else if (st?.dept) {
      const deptFeature = _deptGeojson?.features?.find(f => f.properties.code === st.dept);
      map.setFilter('depts-selected', ['==', ['get', 'code'], st.dept]);
      updateDeptPanel(st.dept, deptFeature?.properties?.nom ?? '', deptData[st.dept]);
    }
  });
}

function _communeCenter(code) {
  const f = _geojson.features.find(f => f.properties.code === code);
  if (!f) return [2.35, 46.5];
  const coords = f.geometry.type === 'Polygon'
    ? f.geometry.coordinates[0]
    : f.geometry.coordinates[0][0];
  const lons = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return [
    (Math.min(...lons) + Math.max(...lons)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

init().catch(err => {
  console.error('Init failed:', err);
  document.getElementById('data-date').textContent = 'Erreur de chargement';
});
