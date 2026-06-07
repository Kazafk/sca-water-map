import { labelFromScore, colorFromScore, flagsFromParams, cappedScore } from './scoring.js';

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
  { key: 'ph',          label: 'pH',          unit: '',            lo: 6.5, hi: 7.5, decimals: 2 },
  { key: 'tds',         label: 'TDS',         unit: 'mg/L',        lo: 75,  hi: 250 },
  { key: 'na',          label: 'Sodium',      unit: 'mg/L',        lo: 0,   hi: 30  },
  { key: 'cl',          label: 'Chlorures',   unit: 'mg/L',        lo: 0,   hi: 75  },
  { key: 'cl2',         label: 'Chlore libre',unit: 'mg/L',        lo: 0,   hi: 0.1, decimals: 2 },
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
  partial_ca:      ()  => 'ℹ Score partiel — Ca Hardness absent (ni mesure directe ni TH disponibles), score plafonné à 85 %',
  partial_na:      ()  => 'ℹ Score partiel — Sodium absent, score plafonné à 95 % (mesure non obligatoire réglementairement)',
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

function _renderTabs(activeTab) {
  return `<div class="panel-tabs">
    <button class="panel-tab${activeTab === 'params' ? ' active' : ''}" data-action="switch-tab" data-tab="params">Paramètres</button>
    <button class="panel-tab${activeTab === 'data'   ? ' active' : ''}" data-action="switch-tab" data-tab="data">Données brutes</button>
  </div>`;
}

// SANDRE param codes → display labels (codes vérifiés via compute_scores.py)
const SANDRE_LABELS = {
  '1302': 'pH',
  '1303': 'Conductivité (µS/cm)',
  '1335': 'Chlore libre (mg/L)',
  '1337': 'Chlorures (mg/L)',
  '1347': 'TAC / Alcalinité (mmol/L)',
  '1350': 'Dureté TH (°f)',
  '1374': 'Calcium (mg/L)',
  '1375': 'Sodium (mg/L)',
};

const SANDRE_PRIORITY = ['1374','1347','1302','1350','1375','1337','1335','1303'];

const SANDRE_SHORT = {
  '1302': 'pH', '1303': 'Cond.', '1335': 'Cl₂', '1337': 'Cl⁻',
  '1347': 'TAC', '1350': 'TH', '1374': 'Ca', '1375': 'Na',
};

// SCA ideal ranges in Hub'Eau native units (source: compute_scores.py convert_params)
const SEASON_SCA_RANGES = {
  '1374': { lo: 20.0, hi: 34.0 },  // Ca mg/L  (SCA 50–85 mg/L CaCO₃ ÷ 2.497)
  '1347': { lo: 4.0,  hi: 7.0  },  // TAC mmol/L (SCA 40–70 mg/L CaCO₃ ÷ 10)
  '1302': { lo: 6.5,  hi: 7.5  },  // pH
  '1303': { lo: 115,  hi: 385  },  // Conductivité µS/cm (TDS 75–250 ÷ 0.65)
  '1375': { lo: 0,    hi: 30   },  // Na mg/L
  '1337': { lo: 0,    hi: 75   },  // Cl mg/L
  '1335': { lo: 0,    hi: 0.1  },  // Cl₂ mg/L
};

function _seasonalityChart(items, code) {
  const raw = items
    .filter(r => r.code_parametre === code && r.resultat_numerique != null)
    .map(r => ({ v: r.resultat_numerique, d: new Date(r.date_prelevement) }))
    .filter(r => !isNaN(r.d.getTime()))
    .sort((a, b) => a.d - b.d);

  if (raw.length < 2) return '';

  // Aggregate to one point per month (median). Avoids stacking of many stations on same date.
  const byMonth = {};
  for (const p of raw) {
    const key = `${p.d.getFullYear()}-${String(p.d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { d: new Date(p.d.getFullYear(), p.d.getMonth(), 15), vals: [] };
    byMonth[key].vals.push(p.v);
  }
  const pts = Object.values(byMonth)
    .sort((a, b) => a.d - b.d)
    .map(m => {
      const sorted = [...m.vals].sort((a, b) => a - b);
      return { v: sorted[Math.floor(sorted.length / 2)], d: m.d, n: m.vals.length };
    });

  if (pts.length < 2) return '';

  const W=248, H=118, PL=30, PR=6, PT=8, PB=22;
  const CW=W-PL-PR, CH=H-PT-PB;
  const f = n => n.toFixed(1);

  const dates  = pts.map(p => p.d.getTime());
  const vals   = pts.map(p => p.v);
  const minD   = Math.min(...dates), maxD = Math.max(...dates);
  const rawMin = Math.min(...vals),  rawMax = Math.max(...vals);
  const range  = SEASON_SCA_RANGES[code];

  // Y scale: include SCA band in view
  const dataSpan = rawMax - rawMin || 1;
  const vLo = range ? Math.min(rawMin, range.lo) - dataSpan * 0.08 : rawMin - dataSpan * 0.12;
  const vHi = range ? Math.max(rawMax, range.hi) + dataSpan * 0.08 : rawMax + dataSpan * 0.12;
  const vSpan = vHi - vLo || 1;

  const sx = d => PL + ((d - minD) / (maxD - minD || 1)) * CW;
  const sy = v => PT + CH - ((v - vLo) / vSpan) * CH;

  // SCA reference band
  let refBand = '';
  if (range) {
    const ryT = Math.max(PT,    sy(Math.min(range.hi, vHi)));
    const ryB = Math.min(PT+CH, sy(Math.max(range.lo, vLo)));
    if (ryB > ryT)
      refBand = `<rect x="${f(PL)}" y="${f(ryT)}" width="${f(CW)}" height="${f(ryB-ryT)}"
        fill="var(--green)" fill-opacity=".12"/>`;
  }

  // Polyline
  const polyPts = pts.map(p => `${f(sx(p.d.getTime()))},${f(sy(p.v))}`).join(' ');

  // Dots — colored by SCA range
  const dotEls = pts.map(p => {
    const inRange = range ? p.v >= range.lo && p.v <= range.hi : true;
    const tip = `${p.d.toLocaleDateString('fr-FR')} · ${p.v}`;
    return `<circle cx="${f(sx(p.d.getTime()))}" cy="${f(sy(p.v))}" r="2.5"
      fill="${inRange ? 'var(--green)' : 'var(--orange)'}"
      stroke="var(--surface)" stroke-width="1"><title>${_esc(tip)}</title></circle>`;
  }).join('');

  // X labels (3 max)
  const xIdxs = pts.length <= 3 ? pts.map((_, i) => i) : [0, Math.floor((pts.length-1)/2), pts.length-1];
  const xLabels = xIdxs.map(i => {
    const p = pts[i];
    const lbl = p.d.toLocaleDateString('fr-FR', { month:'2-digit', year:'2-digit' });
    return `<text x="${f(sx(p.d.getTime()))}" y="${f(PT+CH+9)}" fill="var(--muted)"
      font-size="5.5" text-anchor="middle" font-family="sans-serif">${lbl}</text>`;
  }).join('');

  // Y labels (3 ticks)
  const dec = rawMax < 2 ? 2 : rawMax < 10 ? 1 : 0;
  const yLabels = [0, 0.5, 1].map(t => {
    const v = vLo + vSpan * t;
    return `<text x="${f(PL-3)}" y="${f(sy(v)+2.5)}" fill="var(--muted)"
      font-size="5.5" text-anchor="end" font-family="sans-serif">${v.toFixed(dec)}</text>`;
  }).join('');

  // Average dashed line
  const avg  = vals.reduce((a, b) => a + b, 0) / vals.length;
  const avgY = f(sy(avg));
  const avgLine = `<line x1="${f(PL)}" y1="${avgY}" x2="${f(PL+CW)}" y2="${avgY}"
    stroke="var(--muted)" stroke-width=".8" stroke-dasharray="3,2" opacity=".5"/>`;

  const unit = items.find(r => r.code_parametre === code)?.libelle_unite ?? '';
  const rawN = raw.length;
  const monthsNote = rawN > pts.length ? ` (${rawN} mes.)` : '';
  const statsStr = `${pts.length} mois${monthsNote} · moy. ${avg.toFixed(dec)} · min ${rawMin.toFixed(dec)} · max ${rawMax.toFixed(dec)}${unit ? ' ' + unit : ''}`;

  return `
    <div style="font-size:8.5px;color:var(--muted);text-align:center;margin-bottom:3px">${_esc(statsStr)}</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible">
      <rect width="${W}" height="${H}" fill="var(--bg)" rx="3"/>
      ${refBand}
      <line x1="${f(PL)}" y1="${f(PT)}" x2="${f(PL)}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>
      <line x1="${f(PL)}" y1="${f(PT+CH)}" x2="${f(PL+CW)}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>
      ${yLabels}${xLabels}${avgLine}
      <polyline points="${polyPts}" fill="none" stroke="var(--blue)"
        stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dotEls}
    </svg>`;
}

function _renderDataTab(rawData, selectedCode) {
  if (rawData === null) {
    return `<div class="panel-section">
      <div class="data-loading">
        <div class="data-spinner"></div>
        <div style="font-size:11px;color:var(--muted)">Chargement Hub'Eau…</div>
      </div>
    </div>`;
  }

  if (rawData?.error) {
    return `<div class="panel-section">
      <div class="panel-alert">⚠ Impossible de charger : ${_esc(rawData.error)}</div>
    </div>`;
  }

  const items = rawData?.data ?? [];
  if (!items.length) {
    return `<div class="panel-section">
      <div style="color:var(--muted);font-size:11px;text-align:center;padding:16px 0">
        Aucune mesure disponible via Hub'Eau
      </div>
    </div>`;
  }

  // Params with ≥1 numeric value (chartable), limited to known priority codes
  const chartable = SANDRE_PRIORITY.filter(code =>
    items.filter(r => r.code_parametre === code && r.resultat_numerique != null).length >= 1
  );

  // Auto-select
  if (!selectedCode || !chartable.includes(selectedCode))
    selectedCode = chartable[0] ?? null;

  // Pills
  const pills = chartable.length > 1
    ? `<div class="season-pills">${chartable.map(code => {
        const lbl = SANDRE_SHORT[code] ?? (SANDRE_LABELS[code]?.split(/[\s(/]/)[0] ?? code);
        return `<button class="season-pill${code === selectedCode ? ' active' : ''}"
          data-action="select-season-param" data-code="${code}"
          title="${_esc(SANDRE_LABELS[code] ?? code)}">${_esc(lbl)}</button>`;
      }).join('')}</div>`
    : '';

  const chart = selectedCode ? _seasonalityChart(items, selectedCode) : '';
  const label = selectedCode
    ? (SANDRE_LABELS[selectedCode] ?? items.find(r => r.code_parametre === selectedCode)?.libelle_parametre ?? selectedCode)
    : '';

  const selRows = selectedCode
    ? items.filter(r => r.code_parametre === selectedCode).slice(0, 6).map(r => {
        const d   = r.date_prelevement
          ? new Date(r.date_prelevement).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit' })
          : '—';
        const num = r.resultat_numerique != null ? String(r.resultat_numerique) : (r.resultat_alphanumerique ?? '—');
        const unit = r.libelle_unite ?? '';
        const lieu = (r.nom_udi ?? r.libelle_commune ?? '').slice(0, 28);
        return `<div class="raw-data-row">
          <span class="raw-data-date">${d}</span>
          <span class="raw-data-val">${_esc(num)}<span style="font-weight:normal;color:var(--muted);margin-left:2px">${_esc(unit)}</span></span>
          <span class="raw-data-lieu" title="${_esc(lieu)}">${_esc(lieu)}</span>
        </div>`;
      }).join('')
    : '';

  const total = rawData.count ?? items.length;

  return `${pills}
    ${chart ? `<div class="panel-section" style="padding-top:8px">${chart}</div>` : ''}
    ${selectedCode ? `<div class="panel-section">
      <div class="panel-section-title">${_esc(label)}</div>
      ${selRows || '<div style="color:var(--muted);font-size:10px">Aucune mesure numérique</div>'}
    </div>` : ''}
    <div style="padding:6px 14px 10px;font-size:9px;color:var(--muted);text-align:center">
      ${total} mesure${total > 1 ? 's' : ''} au total ·
      <a href="https://hubeau.eaufrance.fr" target="_blank" rel="noopener" style="color:var(--muted)">Hub'Eau</a>
    </div>`;
}

export function updatePanel(commune, generatedAt, totalScored, { showBottled = false, activeTab = 'params', rawData = undefined, selectedCode = null } = {}) {
  document.getElementById('panel-empty').hidden  = true;
  const content = document.getElementById('panel-content');
  content.hidden = false;

  const { nom, score: rawScore, params, dates, insee, pts, ca_from_th } = commune;
  const score  = cappedScore(rawScore, params);
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

  const paramsContent = `
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
      ${PARAMS.map(p => _paramBar(p, params[p.key], p.key === 'ca_hardness' && !!ca_from_th)).join('')}
    </div>

    ${_coffeeRecipe(params)}
    ${_treatmentAdvice(params)}
    ${reseauNote}
    ${ca_from_th ? `<div class="panel-alert">⚠ <b>Ca Hardness estimé via Titre Hydrotimétrique</b> — calcul indirect (TH × 0,65), imprécision ±25 %. Score indicatif : la mesure directe du calcium n'est pas disponible dans Hub'Eau.</div>` : ''}
    ${flags.map(f => FLAG_MSG[f] ? `<div class="panel-alert">${FLAG_MSG[f](params)}</div>` : '').join('')}
  `;

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
      </div>
    </div>

    ${_renderTabs(activeTab)}
    ${activeTab === 'params' ? paramsContent : _renderDataTab(rawData ?? null, selectedCode)}
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

  const _cs  = c => cappedScore(c.score, c.params);
  const _col = c => colorFromScore(_cs(c));
  const _lbl = c => labelFromScore(_cs(c));
  const _scoreStr = c => _cs(c) != null ? Math.round(_cs(c) * 100) + ' %' : 'N/A';

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
  const cs    = cappedScore(commune.score, commune.params);
  const color = colorFromScore(cs);
  content.innerHTML = `
    <div class="panel-header">
      <div class="panel-score-row">
        <div>
          <div class="panel-commune">${_esc(commune.nom)}</div>
          <div class="panel-meta" style="color:var(--blue)">Sélectionnez la commune à comparer</div>
        </div>
        <div class="panel-score-val" style="color:${color}">${cs != null ? Math.round(cs * 100) + ' %' : 'N/A'}</div>
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

function _paramBar({ label, unit, lo, hi, decimals = 1 }, val, isEstimated = false) {
  const missing  = val == null;
  // Compare against the rounded display value so status always matches what's shown
  const shown    = missing ? null : parseFloat(val.toFixed(decimals));
  const inRange  = !missing && shown >= lo && shown <= hi;
  const color    = missing ? '#555' : inRange ? '#2ecc71' : '#f39c12';
  const pct      = missing ? 0 : Math.min(100, (val / (Math.max(hi, 1) * 1.5)) * 100);
  const status   = missing ? '—' : inRange ? '✓ idéal' : '⚠ hors plage';
  const prefix   = isEstimated ? '~' : '';
  const valStr   = missing ? '' : ` <span style="color:#555">(${prefix}${val.toFixed(decimals)} ${unit}${isEstimated ? ', estimé' : ''})</span>`;

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

  const W=248, H=190, PL=34, PR=8, PT=12, PB=28;
  const CW=W-PL-PR, CH=H-PT-PB;
  const sx = v => PL + (Math.min(Math.max(v, 0), 160) / 160) * CW;
  const sy = v => PT + CH - (Math.min(Math.max(v, 0), 120) / 120) * CH;
  const f  = n => n.toFixed(1);

  const ix = sx(55), iy = sy(68);
  const px = alk != null ? sx(alk) : null;
  const py = ca  != null ? sy(ca)  : null;

  // Axes
  const axesX = [40, 70, 100, 160];
  const axesY = [17, 50, 68, 85, 120];
  const gridLines = axesX.slice(0,2).map(v =>
    `<line x1="${f(sx(v))}" y1="${f(PT)}" x2="${f(sx(v))}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width=".5" stroke-dasharray="2,2"/>`
  ).join('') + axesY.filter(v => v===50||v===85).map(v =>
    `<line x1="${f(PL)}" y1="${f(sy(v))}" x2="${f(PL+CW)}" y2="${f(sy(v))}" stroke="var(--border)" stroke-width=".5" stroke-dasharray="2,2"/>`
  ).join('');
  const xTicks = axesX.map(v =>
    `<line x1="${f(sx(v))}" y1="${f(PT+CH)}" x2="${f(sx(v))}" y2="${f(PT+CH+3)}" stroke="var(--border)" stroke-width="1"/>
     <text x="${f(sx(v))}" y="${f(PT+CH+9)}" fill="var(--muted)" font-size="6" text-anchor="middle" font-family="sans-serif">${v}</text>`
  ).join('');
  const yTicks = axesY.filter(v => v!==68).map(v =>
    `<line x1="${f(PL-3)}" y1="${f(sy(v))}" x2="${f(PL)}" y2="${f(sy(v))}" stroke="var(--border)" stroke-width="1"/>
     <text x="${f(PL-5)}" y="${f(sy(v)+2.5)}" fill="var(--muted)" font-size="6" text-anchor="end" font-family="sans-serif">${v}</text>`
  ).join('');

  // Historical individual points (staggered fade-in)
  const validPts = (pts || []).filter(p => p.alk != null);
  const indivPts = validPts.map((p, i) => {
    const tip = _esc(`${p.l || 'Lieu inconnu'} · ${p.d}`);
    return `<circle cx="${f(sx(p.alk))}" cy="${f(sy(p.ca))}" r="2.5"
      fill="${pointColor}" fill-opacity=".35" stroke="${pointColor}" stroke-width="0.5"
      class="sca-pt-in" style="animation-delay:${i*25}ms" cursor="default">
      <title>${tip}</title>
    </circle>`;
  }).join('');
  const nPts = validPts.length;

  // Animated line from commune point to ideal
  let lineAnim = '';
  if (px != null && py != null) {
    const len = f(Math.hypot(px-ix, py-iy));
    lineAnim = `<line x1="${f(px)}" y1="${f(py)}" x2="${f(ix)}" y2="${f(iy)}"
      stroke="var(--muted)" stroke-width=".8" stroke-dasharray="${len} ${len}" stroke-dashoffset="${len}" opacity=".6">
      <animate attributeName="stroke-dashoffset" from="${len}" to="0"
        dur=".5s" begin=".1s" fill="freeze" calcMode="spline" keySplines=".4 0 .2 1" keyTimes="0;1"/>
    </line>`;
  }

  // Main commune point (scale-bounce)
  const avgPoint = px != null && py != null ? `
    ${lineAnim}
    <circle cx="${f(px)}" cy="${f(py)}" r="${nPts > 1 ? 5.5 : 4.5}"
            fill="${pointColor}" stroke="white" stroke-width="1.5" class="sca-dot-in">
      ${nPts > 1 ? `<title>Moyenne · ${nPts} mesures</title>` : ''}
    </circle>
  ` : '';

  // Value label — positioned to avoid edges
  let pointLabel = '';
  if (px != null && py != null && (ca != null || alk != null)) {
    const toRight  = px < PL + CW * 0.65;
    const toBottom = py < PT + CH * 0.45;
    const lx = toRight  ? px + 7 : px - 7;
    const ly = toBottom ? py + 13 : py - 5;
    const anchor = toRight ? 'start' : 'end';
    const caStr  = ca  != null ? ca.toFixed(0)  : '—';
    const alkStr = alk != null ? alk.toFixed(0) : '—';
    pointLabel = `<text x="${f(lx)}" y="${f(ly)}" fill="${pointColor}" font-size="6.5"
      font-family="sans-serif" font-weight="bold" text-anchor="${anchor}" class="sca-label-in">${caStr} / ${alkStr}</text>`;
  }

  // Bottled waters — label anchor avoids right edge
  const bottledPts = showBottled ? BOTTLED_WATERS.map(w => {
    const bx = sx(w.alk), by = sy(w.ca);
    const offX = w.alk > 160, offY = w.ca > 120;
    const tip  = `${w.name} · Ca ${w.ca} / Alk ${w.alk}${offX || offY ? ' (hors échelle)' : ''}`;
    const lx   = bx < PL + CW - 28 ? bx + 5 : bx - 5;
    const anch = bx < PL + CW - 28 ? 'start' : 'end';
    return `<g>
      <circle cx="${f(bx)}" cy="${f(by)}" r="3.5" fill="none"
        stroke="#9b59b6" stroke-width="1.5" stroke-dasharray="${offX||offY ? '2,1' : 'none'}">
        <title>${tip}</title>
      </circle>
      <text x="${f(lx)}" y="${f(by+2.5)}" fill="#9b59b6" font-size="5.5"
            font-family="sans-serif" text-anchor="${anch}">${w.name}</text>
    </g>`;
  }).join('') : '';

  return `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible">
    <rect width="${W}" height="${H}" style="fill:var(--bg)" rx="4"/>

    <!-- Zones -->
    <rect x="${f(sx(40))}" y="${f(sy(85))}" width="${f(sx(75)-sx(40))}" height="${f(sy(17)-sy(85))}"
          fill="var(--orange)" fill-opacity=".08" stroke="var(--orange)" stroke-width=".8" stroke-dasharray="3,2"/>
    <rect x="${f(sx(40))}" y="${f(sy(85))}" width="${f(sx(70)-sx(40))}" height="${f(sy(50)-sy(85))}"
          fill="var(--green)" fill-opacity=".13" stroke="var(--green)" stroke-width="1"/>

    <!-- Zone labels -->
    <text x="${f(sx(55))}" y="${f(sy(67.5)+17)}" fill="var(--green)" fill-opacity=".65"
          font-size="7" font-weight="bold" text-anchor="middle" font-family="sans-serif">Idéal SCA</text>
    <text x="${f(sx(55))}" y="${f(sy(30))}" fill="var(--orange)" fill-opacity=".7"
          font-size="5.5" text-anchor="middle" font-family="sans-serif">Acceptable</text>

    <!-- Grid + axes -->
    ${gridLines}
    <line x1="${f(PL)}" y1="${f(PT+CH)}" x2="${f(PL+CW)}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>
    <line x1="${f(PL)}"   y1="${f(PT)}"    x2="${f(PL)}"   y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>

    <!-- Ticks -->
    ${xTicks}
    ${yTicks}

    <!-- Axis labels -->
    <text x="${f(PL+CW/2)}" y="${f(H-4)}" fill="var(--muted)" font-size="6.5"
          text-anchor="middle" font-family="sans-serif">Alkalinity (mg/L CaCO₃)</text>
    <text x="8" y="${f(PT+CH/2)}" fill="var(--muted)" font-size="6.5"
          text-anchor="middle" font-family="sans-serif"
          transform="rotate(-90,8,${f(PT+CH/2)})">Ca Hardness</text>

    <!-- Target SCA -->
    <circle cx="${f(ix)}" cy="${f(iy)}" r="3.5" fill="var(--green)" fill-opacity=".55"/>
    <text x="${f(ix+5)}" y="${f(iy-4)}" fill="var(--green)" fill-opacity=".8"
          font-size="5.5" font-family="sans-serif">Cible 55/68</text>

    <!-- Data -->
    ${bottledPts}
    ${indivPts}
    ${avgPoint}
    ${pointLabel}
  </svg>`;
}

function _scaChartCompare(c1, c2) {
  const W=248, H=190, PL=34, PR=8, PT=12, PB=28;
  const CW=W-PL-PR, CH=H-PT-PB;
  const sx = v => PL + (Math.min(Math.max(v, 0), 160) / 160) * CW;
  const sy = v => PT + CH - (Math.min(Math.max(v, 0), 120) / 120) * CH;
  const f  = n => n.toFixed(1);
  const ix = sx(55), iy = sy(68);

  const pt = (c, col) => {
    const px = c.params.alkalinity  != null ? sx(c.params.alkalinity)  : null;
    const py = c.params.ca_hardness != null ? sy(c.params.ca_hardness) : null;
    if (!px || !py) return '';
    const toRight  = px < PL + CW * 0.65;
    const toBottom = py < PT + CH * 0.45;
    const lx = toRight  ? px + 7 : px - 7;
    const ly = toBottom ? py + 12 : py - 4;
    const anchor = toRight ? 'start' : 'end';
    const caStr  = c.params.ca_hardness?.toFixed(0) ?? '—';
    const alkStr = c.params.alkalinity?.toFixed(0)  ?? '—';
    return `<g>
      <circle cx="${f(px)}" cy="${f(py)}" r="5.5"
        fill="${col}" stroke="white" stroke-width="1.5" class="sca-dot-in">
        <title>${c.nom} · Ca ${caStr} / Alk ${alkStr}</title>
      </circle>
      <text x="${f(lx)}" y="${f(ly)}" fill="${col}" font-size="6" font-family="sans-serif"
            font-weight="bold" text-anchor="${anchor}" class="sca-label-in">${c.nom.split(' ')[0]}</text>
    </g>`;
  };

  const xTicks = [40, 70, 100, 160].map(v =>
    `<line x1="${f(sx(v))}" y1="${f(PT+CH)}" x2="${f(sx(v))}" y2="${f(PT+CH+3)}" stroke="var(--border)" stroke-width="1"/>
     <text x="${f(sx(v))}" y="${f(PT+CH+9)}" fill="var(--muted)" font-size="6" text-anchor="middle" font-family="sans-serif">${v}</text>`
  ).join('');
  const yTicks = [17, 50, 85, 120].map(v =>
    `<line x1="${f(PL-3)}" y1="${f(sy(v))}" x2="${f(PL)}" y2="${f(sy(v))}" stroke="var(--border)" stroke-width="1"/>
     <text x="${f(PL-5)}" y="${f(sy(v)+2.5)}" fill="var(--muted)" font-size="6" text-anchor="end" font-family="sans-serif">${v}</text>`
  ).join('');

  return `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible">
    <rect width="${W}" height="${H}" style="fill:var(--bg)" rx="4"/>
    <rect x="${f(sx(40))}" y="${f(sy(85))}" width="${f(sx(75)-sx(40))}" height="${f(sy(17)-sy(85))}"
          fill="var(--orange)" fill-opacity=".08" stroke="var(--orange)" stroke-width=".8" stroke-dasharray="3,2"/>
    <rect x="${f(sx(40))}" y="${f(sy(85))}" width="${f(sx(70)-sx(40))}" height="${f(sy(50)-sy(85))}"
          fill="var(--green)" fill-opacity=".13" stroke="var(--green)" stroke-width="1"/>
    <text x="${f(sx(55))}" y="${f(sy(67.5)+17)}" fill="var(--green)" fill-opacity=".65"
          font-size="7" font-weight="bold" text-anchor="middle" font-family="sans-serif">Idéal SCA</text>
    <line x1="${f(PL)}" y1="${f(PT+CH)}" x2="${f(PL+CW)}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>
    <line x1="${f(PL)}"   y1="${f(PT)}"    x2="${f(PL)}"   y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>
    ${xTicks}
    ${yTicks}
    <text x="${f(PL+CW/2)}" y="${f(H-4)}" fill="var(--muted)" font-size="6.5"
          text-anchor="middle" font-family="sans-serif">Alkalinity (mg/L CaCO₃)</text>
    <text x="8" y="${f(PT+CH/2)}" fill="var(--muted)" font-size="6.5"
          text-anchor="middle" font-family="sans-serif"
          transform="rotate(-90,8,${f(PT+CH/2)})">Ca Hardness</text>
    <circle cx="${f(ix)}" cy="${f(iy)}" r="3.5" fill="var(--green)" fill-opacity=".55"/>
    ${pt(c1, colorFromScore(cappedScore(c1.score, c1.params)))}
    ${pt(c2, colorFromScore(cappedScore(c2.score, c2.params)))}
  </svg>`;
}
