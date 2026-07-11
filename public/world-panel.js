import { labelFromScore, colorFromScore } from './scoring.js';

const PARAMS = [
  { key: 'ca_hardness', label: 'Ca Hardness', unit: 'mg/L CaCO₃', lo: 50,  hi: 85  },
  { key: 'alkalinity',  label: 'Alcalinité',  unit: 'mg/L CaCO₃', lo: 40,  hi: 70  },
  { key: 'ph',          label: 'pH',          unit: '',            lo: 6.5, hi: 7.5, decimals: 2 },
  { key: 'tds',         label: 'TDS',         unit: 'mg/L',        lo: 75,  hi: 250 },
  { key: 'na',          label: 'Sodium',      unit: 'mg/L',        lo: 0,   hi: 30  },
  { key: 'cl',          label: 'Chlorures',   unit: 'mg/L',        lo: 0,   hi: 75  }
];

function _scoreGauge(score) {
  if (score == null) return `<div class="score-gauge"><div class="score-fill nodata" style="width:0%"></div></div>`;
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const col = colorFromScore(score);
  return `<div class="score-gauge"><div class="score-fill" style="width:${pct}%; background:${col}"></div></div>`;
}

function _paramBar(val, p) {
  if (val == null) return '<div class="param-bar empty"></div>';
  const span = p.hi - p.lo;
  const idealW = 100;
  // Let's make a simplified bar where the ideal range is highlighted
  let left = 0, width = 0, color = 'var(--muted)';
  
  const minV = p.lo - span;
  const maxV = p.hi + span;
  
  let pct = (val - minV) / (maxV - minV) * 100;
  pct = Math.max(0, Math.min(100, pct));
  
  if (val >= p.lo && val <= p.hi) color = 'var(--green)';
  else color = 'var(--orange)';
  
  return `<div class="param-bar">
    <div class="param-ideal-zone" style="left: 25%; width: 50%;"></div>
    <div class="param-marker" style="left: ${pct}%; background:${color}"></div>
  </div>`;
}

export function renderWorldCityPanel(city) {
  const scorePct = city.score != null ? Math.round(city.score * 100) : '—';
  const col = colorFromScore(city.score);
  const label = labelFromScore(city.score);
  
  const rows = PARAMS.map(p => {
    const v = city.params[p.key];
    const valStr = v != null ? (p.decimals ? v.toFixed(p.decimals) : Math.round(v)) : '—';
    return `
      <div class="param-row">
        <div class="param-name">${p.label} <span class="param-unit">${p.unit}</span></div>
        <div class="param-val">${valStr}</div>
        <div class="param-vis">${_paramBar(v, p)}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="panel-header">
      <div class="panel-title-row">
        <h2 class="panel-title">${city.name}</h2>
        <div class="panel-score" style="color:${col}">${scorePct}<span class="panel-score-unit">%</span></div>
      </div>
      <div class="panel-subtitle">${city.country_name} (${city.country})</div>
    </div>
    <div class="panel-tags">
      <span class="tag" style="background:${col}20; color:${col}">${label}</span>
    </div>
    
    <div class="panel-section">
      <div class="panel-section-title">Paramètres physico-chimiques</div>
      <div class="params-table">
        ${rows}
      </div>
    </div>
  `;
}

export function renderNoDataPanel(placeName) {
  return `
    <div class="panel-header">
      <div class="panel-title-row">
        <h2 class="panel-title">${placeName}</h2>
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

export function renderWorldCountryPanel(country, topCities) {
  const scorePct = country.avg_score != null ? Math.round(country.avg_score * 100) : '—';
  const col = colorFromScore(country.avg_score);
  
  const cityRows = topCities.map(c => {
    const sPct = c.score != null ? Math.round(c.score * 100) : '—';
    const sCol = colorFromScore(c.score);
    return `
      <div class="top-city-row" data-city-id="${c.id}">
        <div class="top-city-name">${c.name}</div>
        <div class="top-city-score" style="color:${sCol}">${sPct}%</div>
      </div>
    `;
  }).join('');

  return `
    <div class="panel-header">
      <div class="panel-title-row">
        <h2 class="panel-title">${country.name}</h2>
        <div class="panel-score" style="color:${col}">${scorePct}<span class="panel-score-unit">%</span></div>
      </div>
      <div class="panel-subtitle">${country.scored_count} villes évaluées sur ${country.city_count}</div>
    </div>
    
    <div class="panel-section">
      ${_scoreGauge(country.avg_score)}
    </div>
    
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
  `;
}
