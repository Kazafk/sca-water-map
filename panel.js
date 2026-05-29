// public/panel.js
import { labelFromScore, colorFromScore, flagsFromParams } from './scoring.js';

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PARAMS = [
  { key: 'ca_hardness', label: 'Ca Hardness', unit: 'mg/L CaCO₃', lo: 50,  hi: 85  },
  { key: 'alkalinity',  label: 'Alcalinité',  unit: 'mg/L CaCO₃', lo: 40,  hi: 70  },
  { key: 'ph',          label: 'pH',          unit: '',            lo: 6.5, hi: 7.5 },
  { key: 'tds',         label: 'TDS',         unit: 'mg/L',        lo: 75,  hi: 250 },
  { key: 'na',          label: 'Sodium',      unit: 'mg/L',        lo: 0,   hi: 30  },
  { key: 'cl',          label: 'Chlorures',   unit: 'mg/L',        lo: 0,   hi: 75  },
  { key: 'cl2',         label: 'Chlore libre',unit: 'mg/L',        lo: 0,   hi: 0   },
];

const FLAG_MSG = {
  chlore_detected: (p) => `⚠ Chlore libre détecté (${p.cl2?.toFixed(2)} mg/L) — laisser reposer 10 min ou filtrer au charbon`,
  too_hard:        ()  => '⚠ Eau très dure — extraction rapide, café sur-extrait probable',
  too_soft:        ()  => '⚠ Eau trop douce — peu de minéraux, café plat probable',
  too_alkaline:    ()  => '⚠ Alcalinité élevée — peut masquer les arômes acides',
  data_old:        ()  => '⚠ Certaines mesures datent de plus de 12 mois',
};

export function updatePanel(commune, generatedAt) {
  document.getElementById('panel-empty').hidden  = true;
  const content = document.getElementById('panel-content');
  content.hidden = false;

  const { nom, score, params, dates, insee } = commune;
  const color  = colorFromScore(score);
  const label  = labelFromScore(score);
  const flags  = flagsFromParams(params, dates, generatedAt);
  const dept   = insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2);
  const lastDate = Object.values(dates).filter(Boolean).sort().at(-1);
  const dateStr  = lastDate
    ? new Date(lastDate).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : 'date inconnue';

  content.innerHTML = `
    <div class="panel-header">
      <div class="panel-score-row">
        <div>
          <div class="panel-commune">${_esc(nom)}</div>
          <div class="panel-meta">Dép. ${dept} · ${dateStr}</div>
        </div>
        <div>
          <div class="panel-score-val" style="color:${color}">
            ${score != null ? Math.round(score * 100) + ' %' : 'N/A'}
          </div>
          <span class="panel-score-lbl" style="background:${color}">${label}</span>
        </div>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">SCA Water Chart</div>
      ${_scaChart(params.ca_hardness, params.alkalinity, color)}
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Paramètres</div>
      ${PARAMS.map(p => _paramBar(p, params[p.key])).join('')}
    </div>

    ${flags.map(f => FLAG_MSG[f] ? `<div class="panel-alert">${FLAG_MSG[f](params)}</div>` : '').join('')}
  `;
}

function _paramBar({ label, unit, lo, hi }, val) {
  const missing = val == null;
  const inRange = !missing && val >= lo && val <= hi;
  const color   = missing ? '#555' : inRange ? '#2ecc71' : '#f39c12';
  const pct     = missing ? 0 : Math.min(100, (val / (Math.max(hi, 1) * 1.5)) * 100);
  const status  = missing ? '—' : inRange ? '✓ idéal' : '⚠ hors plage';
  const valStr  = missing ? '' : ` <span style="color:#555">(${+val.toFixed(1)} ${unit})</span>`;

  return `
    <div class="param-item">
      <div class="param-row">
        <span class="param-name">${label}${valStr}</span>
        <span style="font-size:10px;color:${color}">${status}</span>
      </div>
      <div class="param-bar-bg">
        <div class="param-bar" style="width:${pct}%;background:${color}"></div>
      </div>
    </div>`;
}

function _scaChart(ca, alk, pointColor) {
  const W=220, H=160, PL=30, PR=10, PT=10, PB=20;
  const CW=W-PL-PR, CH=H-PT-PB;
  // X axis = Alkalinity (0..160), Y axis = Ca Hardness (0..120, inverted top=high)
  const sx = v => PL + (Math.min(Math.max(v, 0), 160) / 160) * CW;
  const sy = v => PT + CH - (Math.min(Math.max(v, 0), 120) / 120) * CH;

  const ix = sx(55), iy = sy(68);  // ideal center
  const px = alk != null ? sx(alk) : null;
  const py = ca  != null ? sy(ca)  : null;

  return `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%">
    <rect width="${W}" height="${H}" fill="#0d1117" rx="4"/>
    <!-- Acceptable zone: Alk 40-75, Ca 17-85 -->
    <rect x="${sx(40)}" y="${sy(85)}" width="${sx(75)-sx(40)}" height="${sy(17)-sy(85)}"
          fill="#f39c12" fill-opacity=".08" stroke="#f39c12" stroke-width=".8" stroke-dasharray="3,2"/>
    <!-- Ideal zone: Alk 40-70, Ca 50-85 -->
    <rect x="${sx(40)}" y="${sy(85)}" width="${sx(70)-sx(40)}" height="${sy(50)-sy(85)}"
          fill="#2ecc71" fill-opacity=".15" stroke="#2ecc71" stroke-width="1"/>
    <text x="${sx(42)}" y="${sy(83)}" fill="#2ecc71" font-size="5.5" font-family="sans-serif">Idéal</text>
    <!-- Ideal center -->
    <circle cx="${ix}" cy="${iy}" r="3" fill="#2ecc71" fill-opacity=".5"/>
    ${px != null && py != null ? `
      <line x1="${px}" y1="${py}" x2="${ix}" y2="${iy}"
            stroke="#888" stroke-width=".8" stroke-dasharray="2,1.5"/>
      <circle cx="${px}" cy="${py}" r="4"
              fill="${pointColor}" stroke="white" stroke-width="1.2"/>
    ` : ''}
    <!-- Axis labels -->
    <text x="${W/2}" y="${H-2}" fill="#444" font-size="5.5" text-anchor="middle" font-family="sans-serif">Alkalinity (mg/L CaCO₃)</text>
    <text x="8" y="${PT+CH/2}" fill="#444" font-size="5.5" text-anchor="middle" font-family="sans-serif"
          transform="rotate(-90,8,${PT+CH/2})">Ca Hardness</text>
  </svg>`;
}
