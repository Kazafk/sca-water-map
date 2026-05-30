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

// Eaux en bouteille (Ca hardness & alk en mg/L CaCO₃, approximatif)
const BOTTLED_WATERS = [
  { name: 'Volvic',       ca: 29,  alk: 58  },
  { name: 'Mont Roucous', ca: 4,   alk: 7   },
  { name: 'Cristaline',   ca: 72,  alk: 154 },
  { name: 'Thonon',       ca: 105, alk: 115 },
  { name: 'Évian',        ca: 289, alk: 300 },
];

const FLAG_MSG = {
  chlore_detected: (p) => `⚠ Chlore libre détecté (${p.cl2?.toFixed(2)} mg/L) — laisser reposer 10 min ou filtrer au charbon`,
  too_hard:        ()  => '⚠ Eau très dure — extraction rapide, café sur-extrait probable',
  too_soft:        ()  => '⚠ Eau trop douce — peu de minéraux, café plat probable',
  too_alkaline:    ()  => '⚠ Alcalinité élevée — peut masquer les arômes acides',
  data_old:        ()  => '⚠ Certaines mesures datent de plus de 12 mois',
};

function _coffeeRecipe(params) {
  const { ca_hardness: ca, alkalinity: alk, tds, cl2 } = params;
  if (ca == null || alk == null) return '';

  const tips = [];

  if (ca >= 50 && ca <= 85 && alk >= 40 && alk <= 70) {
    tips.push({ icon: '✓', text: 'Profil SCA idéal — convient à toutes les méthodes d\'extraction' });
  } else if (ca < 30) {
    tips.push({ icon: '↑', text: 'Eau douce — favoriser les méthodes d\'immersion (cafetière à piston, cold brew) ; augmenter légèrement la dose de café' });
  } else if (ca > 120) {
    tips.push({ icon: '↓', text: 'Eau très dure — préférer l\'espresso court ; risque de calcaire sur le matériel' });
  }

  if (alk > 100) {
    tips.push({ icon: '↓', text: 'Alcalinité élevée — favoriser les cafés fruités/acidulés pour équilibrer, éviter les torréfactions très claires' });
  } else if (alk < 30) {
    tips.push({ icon: '↑', text: 'Faible alcalinité — tampon acide réduit, préférer des torréfactions medium ; éviter les cafés très acides' });
  }

  if (tds != null && tds > 300) {
    tips.push({ icon: '⚠', text: `TDS élevé (${Math.round(tds)} mg/L) — extraction moins efficace, réduire légèrement la température (88–91 °C)` });
  }

  if (cl2 != null && cl2 > 0) {
    tips.push({ icon: '⚠', text: 'Filtrer au charbon actif avant utilisation pour éliminer le chlore résiduel' });
  }

  if (!tips.length) return '';

  const rows = tips.map(t => `<div class="recipe-tip"><span class="recipe-icon">${t.icon}</span>${t.text}</div>`).join('');
  return `<div class="panel-section"><div class="panel-section-title">Recommandations café</div>${rows}</div>`;
}

function _treatmentAdvice(params) {
  const { ca_hardness: ca, cl2, tds, ph } = params;
  const advice = [];

  if (cl2 != null && cl2 > 0.1) {
    advice.push('Filtre à charbon actif pour éliminer le chlore résiduel');
  }
  if (ca != null && ca > 200) {
    advice.push('Eau très calcaire — adoucisseur ou filtre à osmose inverse recommandé');
  } else if (ca != null && ca > 120) {
    advice.push('Eau dure — filtre anticalcaire conseillé pour protéger les équipements (machine espresso, bouilloire)');
  }
  if (tds != null && tds > 400) {
    advice.push(`TDS élevé (${Math.round(tds)} mg/L) — osmose inverse pour une eau neutre à partir de 0`);
  }
  if (ph != null && ph < 6.5) {
    advice.push(`pH bas (${ph.toFixed(1)}) — eau légèrement acide, vérifier l'état des canalisations`);
  }
  if (!advice.length) return '';

  const rows = advice.map(a => `<div class="treatment-tip">• ${a}</div>`).join('');
  return `<div class="panel-section"><div class="panel-section-title">Conseils traitement</div>${rows}</div>`;
}

export function updatePanel(commune, generatedAt, totalScored, { showBottled = false } = {}) {
  document.getElementById('panel-empty').hidden  = true;
  const content = document.getElementById('panel-content');
  content.hidden = false;

  const { nom, score, params, dates, insee, pts } = commune;
  const color  = colorFromScore(score);
  const label  = labelFromScore(score);
  const flags  = flagsFromParams(params, dates, generatedAt);
  const dept   = insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2);

  const lastDate = Object.values(dates).filter(Boolean).sort().at(-1);
  const dateStr  = lastDate
    ? new Date(lastDate).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : 'date inconnue';

  const ageDays = lastDate
    ? Math.round((new Date(generatedAt) - new Date(lastDate)) / 86400000)
    : 9999;
  const freshnessColor = ageDays < 180 ? '#2ecc71' : ageDays < 365 ? '#f39c12' : '#e74c3c';
  const freshnessTitle = ageDays < 180 ? 'données récentes' : ageDays < 365 ? 'données 6–12 mois' : 'données > 1 an';

  const nMeasures  = pts?.length ?? 0;
  const validPts   = (pts || []).filter(p => p.ca != null && p.alk != null);
  const nPaired    = validPts.length;

  const measureLabel = nMeasures > 1 ? `· ${nMeasures} mesures Ca` : '';
  const rankLabel  = (commune.rank != null && totalScored)
    ? `· #${commune.rank.toLocaleString('fr-FR')} / ${totalScored.toLocaleString('fr-FR')}`
    : '';
  const reseauNote = commune.reseau
    ? `<div class="panel-alert" style="font-size:11px">ℹ️ Ca/TAC : données du réseau <b>${_esc(commune.reseau)}</b></div>`
    : '';

  const arsUrl = `https://www.eaupotable.sante.gouv.fr/pages/communes/${insee}/resultats-de-la-surveillance`;

  const chartNote = (() => {
    if (nPaired >= 3) {
      const caVals  = validPts.map(p => p.ca);
      const alkVals = validPts.map(p => p.alk);
      const caRange  = Math.max(...caVals)  - Math.min(...caVals);
      const alkRange = Math.max(...alkVals) - Math.min(...alkVals);
      return `<div class="variability-note">Variabilité · Ca ±${(caRange/2).toFixed(0)} · Alk ±${(alkRange/2).toFixed(0)} mg/L</div>`;
    }
    if (nMeasures > nPaired && nPaired === 0)
      return `<div class="variability-note">${nMeasures} mesures Ca — aucune paire Ca+TAC (prélevements distincts)</div>`;
    if (nMeasures > nPaired && nPaired > 0)
      return `<div class="variability-note">${nPaired} paire${nPaired > 1 ? 's' : ''} Ca+TAC · ${nMeasures - nPaired} mesures Ca sans TAC correspondant</div>`;
    return '';
  })();

  const bottledToggle = `<button class="btn-bottled${showBottled ? ' active' : ''}" data-action="toggle-bottled" title="Afficher les eaux en bouteille">
    ${showBottled ? '🍾 Masquer bouteilles' : '🍾 Bouteilles'}
  </button>`;

  content.innerHTML = `
    <div class="panel-header">
      <div class="panel-score-row">
        <div>
          <div class="panel-commune">${_esc(nom)}</div>
          <div class="panel-meta">Dép. ${dept} · <span style="color:${freshnessColor}" title="${freshnessTitle}">${dateStr}</span> ${_esc(measureLabel)}</div>
          ${rankLabel ? `<div class="panel-rank">${rankLabel}</div>` : ''}
        </div>
        <div>
          <div class="panel-score-val" style="color:${color}">
            ${score != null ? Math.round(score * 100) + ' %' : 'N/A'}
          </div>
          <span class="panel-score-lbl" style="background:${color}">${label}</span>
        </div>
      </div>
      <div class="panel-actions">
        <button class="btn-panel-action" data-action="compare">⚖ Comparer</button>
        <a class="btn-panel-action" href="${arsUrl}" target="_blank" rel="noopener" title="Rapport ARS officiel">📋 ARS</a>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title" style="display:flex;justify-content:space-between;align-items:center">
        SCA Water Chart
        ${bottledToggle}
      </div>
      ${_scaChart(params, pts, color, showBottled)}
      ${chartNote}
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Paramètres</div>
      ${PARAMS.map(p => _paramBar(p, params[p.key])).join('')}
    </div>

    ${_coffeeRecipe(params)}
    ${_treatmentAdvice(params)}
    ${reseauNote}
    ${flags.map(f => FLAG_MSG[f] ? `<div class="panel-alert">${FLAG_MSG[f](params)}</div>` : '').join('')}
  `;
}

export function updateDeptPanel(code, nom, deptInfo) {
  document.getElementById('panel-empty').hidden = true;
  const content = document.getElementById('panel-content');
  content.hidden = false;

  const avgScore = deptInfo?.avgScore ?? null;
  const n        = deptInfo?.n ?? 0;
  const color    = colorFromScore(avgScore);
  const label    = labelFromScore(avgScore);

  let ideal = 0, acceptable = 0, horPlage = 0, tres = 0;
  for (const c of (deptInfo?.communes ?? [])) {
    if (c.score == null) continue;
    if      (c.score >= 0.75) ideal++;
    else if (c.score >= 0.50) acceptable++;
    else if (c.score >= 0.25) horPlage++;
    else                      tres++;
  }
  const total = ideal + acceptable + horPlage + tres;

  const top5 = (deptInfo?.communes ?? [])
    .filter(c => c.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  content.innerHTML = `
    <div class="panel-header">
      <div class="panel-score-row">
        <div>
          <div class="panel-commune">Dép. ${_esc(nom)}</div>
          <div class="panel-meta">${code} · ${n} communes scorées</div>
        </div>
        <div>
          <div class="panel-score-val" style="color:${color}">
            ${avgScore != null ? Math.round(avgScore * 100) + ' %' : 'N/A'}
          </div>
          <span class="panel-score-lbl" style="background:${color}">${label}</span>
        </div>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Répartition des communes</div>
      ${_distBar(ideal, acceptable, horPlage, tres, total)}
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Top 5 communes</div>
      ${top5.map((c, i) => `
        <div class="dept-commune-row" data-action="select-commune" data-insee="${c.insee}" style="cursor:pointer">
          <span class="dept-commune-rank">${i + 1}</span>
          <span class="dept-commune-nom">${_esc(c.nom)}</span>
          <span style="color:${colorFromScore(c.score)}">${Math.round(c.score * 100)} %</span>
        </div>`).join('')}
    </div>
  `;
}

export function updateComparePanel(c1, c2, generatedAt) {
  document.getElementById('panel-empty').hidden = true;
  const content = document.getElementById('panel-content');
  content.hidden = false;

  const _col = c => colorFromScore(c.score);
  const _lbl = c => labelFromScore(c.score);
  const _scoreStr = c => c.score != null ? Math.round(c.score * 100) + ' %' : 'N/A';

  const paramRows = PARAMS.map(({ key, label, unit, lo, hi }) => {
    const v1 = c1.params[key], v2 = c2.params[key];
    const fmt = (v) => v == null ? '<span style="color:#555">—</span>'
      : `<span style="color:${v >= lo && v <= hi ? '#2ecc71' : '#f39c12'}">${+v.toFixed(1)} ${unit}</span>`;
    return `<div class="compare-row">
      <span class="compare-val">${fmt(v1)}</span>
      <span class="compare-param">${label}</span>
      <span class="compare-val">${fmt(v2)}</span>
    </div>`;
  }).join('');

  content.innerHTML = `
    <div class="panel-header">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:11px;color:var(--muted)">Comparaison</span>
        <button class="btn-panel-action" data-action="close-compare">✕ Fermer</button>
      </div>
      <div class="compare-header-row" style="margin-top:8px">
        <div class="compare-commune-col">
          <div class="panel-commune" style="font-size:12px">${_esc(c1.nom)}</div>
          <div class="panel-score-val" style="font-size:18px;color:${_col(c1)}">${_scoreStr(c1)}</div>
          <span class="panel-score-lbl" style="background:${_col(c1)}">${_lbl(c1)}</span>
        </div>
        <div style="color:var(--muted);align-self:center;font-size:16px">vs</div>
        <div class="compare-commune-col">
          <div class="panel-commune" style="font-size:12px">${_esc(c2.nom)}</div>
          <div class="panel-score-val" style="font-size:18px;color:${_col(c2)}">${_scoreStr(c2)}</div>
          <span class="panel-score-lbl" style="background:${_col(c2)}">${_lbl(c2)}</span>
        </div>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">SCA Water Chart</div>
      ${_scaChartCompare(c1, c2)}
    </div>

    <div class="panel-section">
      <div class="panel-section-title">
        <div class="compare-header-row" style="font-size:9px">
          <span style="flex:1;text-align:center">${_esc(c1.nom)}</span>
          <span style="width:80px;text-align:center">Paramètre</span>
          <span style="flex:1;text-align:center">${_esc(c2.nom)}</span>
        </div>
      </div>
      ${paramRows}
    </div>
  `;
}

export function showComparePending(commune) {
  document.getElementById('panel-empty').hidden = true;
  const content = document.getElementById('panel-content');
  content.hidden = false;
  const color = colorFromScore(commune.score);
  content.innerHTML = `
    <div class="panel-header">
      <div class="panel-score-row">
        <div>
          <div class="panel-commune">${_esc(commune.nom)}</div>
          <div class="panel-meta" style="color:var(--blue)">Sélectionnez la commune à comparer</div>
        </div>
        <div class="panel-score-val" style="color:${color}">${commune.score != null ? Math.round(commune.score * 100) + ' %' : 'N/A'}</div>
      </div>
    </div>
    <div style="padding:20px 14px;text-align:center;color:var(--muted);font-size:12px">
      Cliquez sur une commune sur la carte ou cherchez-en une dans la barre de recherche
    </div>
    <div style="padding:0 14px">
      <button class="btn-panel-action" data-action="close-compare" style="width:100%">✕ Annuler</button>
    </div>
  `;
}

function _distBar(ideal, acceptable, horPlage, tres, total) {
  if (total === 0) return '<div style="color:var(--muted);font-size:10px">Aucune donnée</div>';
  const pct = n => Math.round(n * 100 / total);
  const seg = (n, col, lbl) => n > 0
    ? `<div style="width:${pct(n)}%;background:${col}" title="${lbl} : ${n}"></div>` : '';
  const leg = (n, col, lbl) => n > 0
    ? `<span style="color:${col}">${pct(n)}% ${lbl}</span>` : '';
  return `
    <div class="dist-bar">
      ${seg(ideal,      '#2ecc71', 'Idéal')}
      ${seg(acceptable, '#3498db', 'Acceptable')}
      ${seg(horPlage,   '#f39c12', 'Hors plage')}
      ${seg(tres,       '#e74c3c', 'Très hors SCA')}
    </div>
    <div class="dist-legend">
      ${leg(ideal,      '#2ecc71', 'idéal')}
      ${leg(acceptable, '#3498db', 'acceptable')}
      ${leg(horPlage,   '#f39c12', 'hors plage')}
      ${leg(tres,       '#e74c3c', 'très hors')}
    </div>`;
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

function _scaChart(params, pts, pointColor, showBottled = false) {
  const ca  = params.ca_hardness;
  const alk = params.alkalinity;
  const W=220, H=160, PL=30, PR=10, PT=10, PB=20;
  const CW=W-PL-PR, CH=H-PT-PB;
  const sx = v => PL + (Math.min(Math.max(v, 0), 160) / 160) * CW;
  const sy = v => PT + CH - (Math.min(Math.max(v, 0), 120) / 120) * CH;

  const ix = sx(55), iy = sy(68);
  const px = alk != null ? sx(alk) : null;
  const py = ca  != null ? sy(ca)  : null;

  const indivPts = (pts || [])
    .filter(p => p.alk != null)
    .map(p => {
      const cx  = sx(p.alk);
      const cy  = sy(p.ca);
      const tip = _esc(`${p.l || 'Lieu inconnu'} · ${p.d}`);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5"
        fill="${pointColor}" fill-opacity="0.35" stroke="${pointColor}" stroke-width="0.5" style="cursor:default">
        <title>${tip}</title>
      </circle>`;
    }).join('');

  const nPts = (pts || []).filter(p => p.alk != null).length;

  const avgPoint = px != null && py != null ? `
    <line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${ix.toFixed(1)}" y2="${iy.toFixed(1)}"
          stroke="#888" stroke-width=".8" stroke-dasharray="2,1.5"/>
    <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${nPts > 1 ? 5 : 4}"
            fill="${pointColor}" stroke="white" stroke-width="1.2">
      ${nPts > 1 ? `<title>Moyenne · ${nPts} point${nPts > 1 ? 's' : ''}</title>` : ''}
    </circle>
  ` : '';

  const bottledPts = showBottled ? BOTTLED_WATERS.map(w => {
    const bx = sx(w.alk), by = sy(w.ca);
    const offX = w.alk > 160, offY = w.ca > 120;
    const tip = `${w.name} · Ca ${w.ca} / Alk ${w.alk} mg/L CaCO₃${offX || offY ? ' (hors échelle)' : ''}`;
    return `<g>
      <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="3"
        fill="none" stroke="#9b59b6" stroke-width="1.2" stroke-dasharray="${offX || offY ? '2,1' : 'none'}">
        <title>${tip}</title>
      </circle>
      <text x="${(bx + 4).toFixed(1)}" y="${(by + 2).toFixed(1)}"
            fill="#9b59b6" font-size="5" font-family="sans-serif">${w.name}</text>
    </g>`;
  }).join('') : '';

  return `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%">
    <rect width="${W}" height="${H}" fill="#0d1117" rx="4"/>
    <rect x="${sx(40).toFixed(1)}" y="${sy(85).toFixed(1)}"
          width="${(sx(75)-sx(40)).toFixed(1)}" height="${(sy(17)-sy(85)).toFixed(1)}"
          fill="#f39c12" fill-opacity=".08" stroke="#f39c12" stroke-width=".8" stroke-dasharray="3,2"/>
    <rect x="${sx(40).toFixed(1)}" y="${sy(85).toFixed(1)}"
          width="${(sx(70)-sx(40)).toFixed(1)}" height="${(sy(50)-sy(85)).toFixed(1)}"
          fill="#2ecc71" fill-opacity=".15" stroke="#2ecc71" stroke-width="1"/>
    <text x="${sx(42).toFixed(1)}" y="${sy(83).toFixed(1)}"
          fill="#2ecc71" font-size="5.5" font-family="sans-serif">Idéal</text>
    <circle cx="${ix.toFixed(1)}" cy="${iy.toFixed(1)}" r="3" fill="#2ecc71" fill-opacity=".5"/>
    ${bottledPts}
    ${indivPts}
    ${avgPoint}
    <text x="${(W/2).toFixed(1)}" y="${H-2}" fill="#444" font-size="5.5" text-anchor="middle" font-family="sans-serif">Alkalinity (mg/L CaCO₃)</text>
    <text x="8" y="${(PT+CH/2).toFixed(1)}" fill="#444" font-size="5.5" text-anchor="middle" font-family="sans-serif"
          transform="rotate(-90,8,${(PT+CH/2).toFixed(1)})">Ca Hardness</text>
  </svg>`;
}

function _scaChartCompare(c1, c2) {
  const W=220, H=160, PL=30, PR=10, PT=10, PB=20;
  const CW=W-PL-PR, CH=H-PT-PB;
  const sx = v => PL + (Math.min(Math.max(v, 0), 160) / 160) * CW;
  const sy = v => PT + CH - (Math.min(Math.max(v, 0), 120) / 120) * CH;
  const ix = sx(55), iy = sy(68);

  const pt = (c, col) => {
    const px = c.params.alkalinity  != null ? sx(c.params.alkalinity)  : null;
    const py = c.params.ca_hardness != null ? sy(c.params.ca_hardness) : null;
    if (!px || !py) return '';
    return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5"
      fill="${col}" stroke="white" stroke-width="1.2">
      <title>${c.nom} · Ca ${c.params.ca_hardness?.toFixed(0)} / Alk ${c.params.alkalinity?.toFixed(0)}</title>
    </circle>`;
  };

  return `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%">
    <rect width="${W}" height="${H}" fill="#0d1117" rx="4"/>
    <rect x="${sx(40).toFixed(1)}" y="${sy(85).toFixed(1)}"
          width="${(sx(70)-sx(40)).toFixed(1)}" height="${(sy(50)-sy(85)).toFixed(1)}"
          fill="#2ecc71" fill-opacity=".15" stroke="#2ecc71" stroke-width="1"/>
    <circle cx="${ix.toFixed(1)}" cy="${iy.toFixed(1)}" r="3" fill="#2ecc71" fill-opacity=".5"/>
    ${pt(c1, colorFromScore(c1.score))}
    ${pt(c2, colorFromScore(c2.score))}
    <text x="${(W/2).toFixed(1)}" y="${H-2}" fill="#444" font-size="5.5" text-anchor="middle" font-family="sans-serif">Alkalinity (mg/L CaCO₃)</text>
    <text x="8" y="${(PT+CH/2).toFixed(1)}" fill="#444" font-size="5.5" text-anchor="middle" font-family="sans-serif"
          transform="rotate(-90,8,${(PT+CH/2).toFixed(1)})">Ca Hardness</text>
  </svg>`;
}
