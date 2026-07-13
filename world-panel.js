import { labelFromScore, colorFromScore } from './scoring.js';

const PARAMS = [
  { key: 'ca_hardness', label: 'Ca Hardness', unit: 'mg/L CaCO₃', lo: 50,  hi: 85  },
  { key: 'alkalinity',  label: 'Alcalinité',  unit: 'mg/L CaCO₃', lo: 40,  hi: 70  },
  { key: 'ph',          label: 'pH',          unit: '',            lo: 6.5, hi: 7.5, decimals: 2 },
  { key: 'tds',         label: 'TDS',         unit: 'mg/L',        lo: 75,  hi: 250 },
  { key: 'na',          label: 'Sodium',      unit: 'mg/L',        lo: 0,   hi: 30  },
  { key: 'cl',          label: 'Chlorures',   unit: 'mg/L',        lo: 0,   hi: 75  }
];

/**
 * Escapes HTML special characters to prevent XSS from external data.
 * @param {string} str
 * @returns {string}
 */
function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _scoreGauge(score) {
  if (score == null) return `<div class="score-gauge"><div class="score-fill nodata" style="width:0%"></div></div>`;
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const col = colorFromScore(score);
  return `<div class="score-gauge"><div class="score-fill" style="width:${pct}%; background:${col}"></div></div>`;
}

function _paramBar(val, p) {
  if (val == null) return '<div class="param-bar empty"></div>';
  const span = p.hi - p.lo;

  const minV = p.lo - span;
  const maxV = p.hi + span;

  let pct = (val - minV) / (maxV - minV) * 100;
  pct = Math.max(0, Math.min(100, pct));

  const color = (val >= p.lo && val <= p.hi) ? 'var(--green)' : 'var(--orange)';

  return `<div class="param-bar">
    <div class="param-ideal-zone" style="left: 25%; width: 50%;"></div>
    <div class="param-marker" style="left: ${pct}%; background:${color}"></div>
  </div>`;
}

/**
 * Renders the side panel for a world city.
 * @param {{ id: string, name: string, country: string, country_name: string,
 *           lat: number, lng: number, score: number|null,
 *           params: { ca_hardness: number|null, alkalinity: number|null,
 *                     ph: number|null, tds: number|null,
 *                     na: number|null, cl: number|null } }} city
 * @returns {string} HTML string
 */
export function renderWorldCityPanel(city) {
  const scorePct = city.score != null ? Math.round(city.score * 100) : '—';
  const col = colorFromScore(city.score);
  const label = labelFromScore(city.score);

  // --- Parameter completeness ---
  const availableCount = PARAMS.filter(p => city.params[p.key] != null).length;
  const isPartialData = availableCount < 3;
  const noCaHardness = city.params.ca_hardness == null;

  const rows = PARAMS.map(p => {
    const v = city.params[p.key];
    const valStr = v != null ? (p.decimals ? v.toFixed(p.decimals) : Math.round(v)) : '—';
    return `
      <div class="param-row">
        <div class="param-name">${_esc(p.label)} <span class="param-unit">${_esc(p.unit)}</span></div>
        <div class="param-val">${valStr}</div>
        <div class="param-vis">${_paramBar(v, p)}</div>
      </div>
    `;
  }).join('');

  // Ca hardness warning block (uses existing .panel-alert class).
  // city.deg = score dégradé : ni dureté ni alcalinité, calcul sur les seuls
  // paramètres secondaires, plafonné à 50 % (polygone hachuré sur la carte).
  const caWarning = city.deg ? `
    <div class="panel-alert">
      Score estimé, plafonné à 50 % — dureté et alcalinité non mesurées
      (calcul sur pH/TDS/Na/Cl uniquement)
    </div>
  ` : (noCaHardness ? `
    <div class="panel-alert">
      Score plafonné a 85 % — dureté calcique non mesurée
    </div>
  ` : '');

  // "Données partielles" badge appended to the tag row when < 3 params
  const partialBadge = isPartialData
    ? `<span class="tag" style="background:var(--orange)20; color:var(--orange)">Données partielles</span>`
    : '';

  // Completeness header inside the params section
  const completenessLabel = `
    <div style="font-size:10px; color:var(--muted); margin-bottom:8px;">
      ${availableCount}/6 paramètres disponibles
    </div>
  `;

  // Data provenance footer
  const provenanceFooter = `
    <div style="padding:8px 14px; font-size:10px; color:var(--muted); border-top:1px solid var(--border);">
      Source : rapports publics des compagnies des eaux (tap-water-db)
    </div>
  `;

  return `
    <div class="panel-header">
      <div class="panel-title-row">
        <h2 class="panel-title">${_esc(city.name)}</h2>
        <div class="panel-score" style="color:${col}">${scorePct}<span class="panel-score-unit">%</span></div>
      </div>
      <div class="panel-subtitle">${_esc(city.country_name)} (${_esc(city.country)})</div>
    </div>
    <div class="panel-tags">
      <span class="tag" style="background:${col}20; color:${col}">${_esc(label)}</span>
      ${partialBadge}
    </div>
    ${caWarning}
    <div class="panel-section">
      <div class="panel-section-title">Paramètres physico-chimiques</div>
      ${completenessLabel}
      <div class="params-table">
        ${rows}
      </div>
    </div>
    ${provenanceFooter}
  `;
}

/**
 * Renders the side panel when no data is available for a place.
 * @param {string} placeName
 * @returns {string} HTML string
 */
export function renderNoDataPanel(placeName) {
  return `
    <div class="panel-header">
      <div class="panel-title-row">
        <h2 class="panel-title">${_esc(placeName)}</h2>
      </div>
      <div class="panel-subtitle">Aucune donnée SCA disponible</div>
    </div>
    <div class="panel-section">
      <p style="color:var(--muted);font-size:13px;line-height:1.6">
        Cette localité ne figure pas dans notre base de données.<br>
        Seules les villes couvertes par <strong>tap-water-db</strong> sont évaluées.
      </p>
    </div>
  `;
}

/**
 * Renders the side panel for a world country or province/state.
 * @param {{ iso2: string, name: string, avg_score: number|null,
 *           city_count: number, scored_count: number }} country
 * @param {Array<{ id: string, name: string, score: number|null }>} topCities
 * @returns {string} HTML string
 */
export function renderWorldCountryPanel(country, topCities) {
  const scorePct = country.avg_score != null ? Math.round(country.avg_score * 100) : '—';
  const col = colorFromScore(country.avg_score);
  const n = country.scored_count ?? 0;

  // --- Representativity badge ---
  let representativityBlock = '';
  if (n <= 3) {
    representativityBlock = `
      <div style="margin:8px 14px 4px;">
        <span class="tag" style="background:var(--orange)20; color:var(--orange); font-size:10px;">
          Couverture faible — moyenne sur ${n} ville${n !== 1 ? 's' : ''}
        </span>
        <div style="font-size:10px; color:var(--muted); margin-top:4px; line-height:1.5;">
          Cette moyenne n'est pas représentative du territoire entier.
        </div>
      </div>
    `;
  } else if (n <= 10) {
    representativityBlock = `
      <div style="margin:4px 14px; font-size:10px; color:var(--muted);">
        Basé sur ${n} villes
      </div>
    `;
  }
  // n > 10: le sous-titre "X villes évaluées sur Y" suffit

  const cityRows = topCities.map(c => {
    const sPct = c.score != null ? Math.round(c.score * 100) : '—';
    const sCol = colorFromScore(c.score);
    return `
      <div class="top-city-row" data-city-id="${_esc(c.id)}">
        <div class="top-city-name">${_esc(c.name)}</div>
        <div class="top-city-score" style="color:${sCol}">${sPct}%</div>
      </div>
    `;
  }).join('');

  // Data provenance footer
  const provenanceFooter = `
    <div style="padding:8px 14px; font-size:10px; color:var(--muted); border-top:1px solid var(--border);">
      Source : rapports publics des compagnies des eaux (tap-water-db)
    </div>
  `;

  return `
    <div class="panel-header">
      <div class="panel-title-row">
        <h2 class="panel-title">${_esc(country.name)}</h2>
        <div class="panel-score" style="color:${col}">${scorePct}<span class="panel-score-unit">%</span></div>
      </div>
      <div class="panel-subtitle">${n} villes évaluées sur ${country.city_count ?? '—'}</div>
    </div>

    <div class="panel-section">
      ${_scoreGauge(country.avg_score)}
    </div>

    ${representativityBlock}

    ${topCities.length > 0 ? `
    <div class="panel-section">
      <div class="panel-section-title">Top villes (score SCA)</div>
      <div class="top-cities-list">
        ${cityRows}
      </div>
    </div>
    ` : `
    <div class="panel-section">
      <p style="color:var(--muted); font-size:12px;">Aucune donnée suffisante pour les villes de ce pays.</p>
    </div>
    `}
    ${provenanceFooter}
  `;
}
