import { scoreFromParams, colorFromScore, labelFromScore } from './scoring.js';

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Curated waters — chargées depuis curated_waters.json ─────────────────────
// Source : bottled-water-db YAML files, converties par data/convert_bottled_db.py
// Ne pas éditer ici : modifier les YAML dans bottled-water-db puis relancer le script.

// ── Compute params + scores ───────────────────────────────────────────────────
function computeEntry(w, curated = false) {
  const params = {
    ca_hardness: w.calcium_mg_l    != null ? Math.round(w.calcium_mg_l    * 2.497  * 10) / 10 : null,
    alkalinity:  w.bicarbonate_mg_l != null ? Math.round(w.bicarbonate_mg_l * 0.8197 * 10) / 10 : null,
    ph:  w.ph,
    tds: w.tds_mg_l,
    na:  w.sodium_mg_l,
    cl:  w.chlorure_mg_l,
    cl2: 0,
  };
  const score = scoreFromParams(params);
  return { ...w, params, score, color: colorFromScore(score), label: labelFromScore(score), _curated: curated };
}

let WATERS = [];  // populated from curated_waters.json

// All waters = curated + mass (populated after fetch)
let ALL_WATERS = [];
let massLoaded = false;

// Top pays by count (capped to top 25 for the filter pills)
function allPays() {
  const counts = {};
  for (const w of ALL_WATERS) counts[w.pays] = (counts[w.pays] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([p]) => p);
}

// ── State ─────────────────────────────────────────────────────────────────────
let S = {
  search: '',
  pays: new Set(),
  categorie: new Set(),
  type: new Set(),
  scoreRange: new Set(),
  durete: new Set(),
  sortCol: 'score',
  sortDir: 'desc',
  selectedId: null,
  page: 0,
  perPage: 50,
};

// ── Filtering + sorting ───────────────────────────────────────────────────────
function filtered() {
  return ALL_WATERS.filter(w => {
    if (S.search) {
      const q = S.search.toLowerCase();
      if (![w.nom, w.pays, w.ville_origine, w.entreprise].some(s => s.toLowerCase().includes(q))) return false;
    }
    if (S.pays.size      && !S.pays.has(w.pays))          return false;
    if (S.categorie.size && !S.categorie.has(w.categorie)) return false;
    if (S.type.size      && !S.type.has(w.type_eau))       return false;
    if (S.scoreRange.size) {
      const s = w.score ?? 0;
      if (!( (S.scoreRange.has('ideal')  && s >= 0.75) ||
             (S.scoreRange.has('accept') && s >= 0.50 && s < 0.75) ||
             (S.scoreRange.has('hors')   && s >= 0.25 && s < 0.50) ||
             (S.scoreRange.has('tres')   && s  < 0.25) )) return false;
    }
    if (S.durete.size) {
      const ca = w.params.ca_hardness ?? 0;
      if (!( (S.durete.has('tres_douce') && ca < 17) ||
             (S.durete.has('douce')      && ca >= 17 && ca < 50) ||
             (S.durete.has('ideale')     && ca >= 50 && ca <= 85) ||
             (S.durete.has('dure')       && ca > 85 && ca <= 170) ||
             (S.durete.has('tres_dure')  && ca > 170) )) return false;
    }
    return true;
  });
}

function sorted(list) {
  const dir = S.sortDir === 'asc' ? 1 : -1;
  const val = w => {
    switch (S.sortCol) {
      case 'nom':         return w.nom;
      case 'pays':        return w.pays;
      case 'score':       return w.score ?? -1;
      case 'ca_hardness': return w.params.ca_hardness ?? -1;
      case 'alkalinity':  return w.params.alkalinity ?? -1;
      case 'ph':          return w.ph ?? -1;
      case 'tds':         return w.tds_mg_l ?? -1;
      case 'na':          return w.sodium_mg_l ?? -1;
      default:            return 0;
    }
  };
  return [...list].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (typeof av === 'string') return av.localeCompare(bv, 'fr') * dir;
    return (av - bv) * dir;
  });
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function renderChart(vis) {
  const W=560, H=240, PL=46, PR=16, PT=20, PB=38;
  const CW=W-PL-PR, CH=H-PT-PB;
  const sx = v => PL + (Math.min(Math.max(v,0),160)/160)*CW;
  const sy = v => PT + CH - (Math.min(Math.max(v,0),120)/120)*CH;
  const f = n => n.toFixed(1);

  const visIds = new Set(vis.map(w => w.id));

  // Axes labels
  const axX = [0, 40, 70, 100, 160];
  const axY = [0, 17, 50, 68, 85, 120];
  const gridLines =
    [40,70].map(v=>`<line x1="${f(sx(v))}" y1="${f(PT)}" x2="${f(sx(v))}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width=".5" stroke-dasharray="2,2"/>`).join('')+
    [50,85].map(v=>`<line x1="${f(PL)}" y1="${f(sy(v))}" x2="${f(PL+CW)}" y2="${f(sy(v))}" stroke="var(--border)" stroke-width=".5" stroke-dasharray="2,2"/>`).join('');
  const xTicks = axX.map(v=>
    `<line x1="${f(sx(v))}" y1="${f(PT+CH)}" x2="${f(sx(v))}" y2="${f(PT+CH+3)}" stroke="var(--border)" stroke-width="1"/>
     <text x="${f(sx(v))}" y="${f(PT+CH+10)}" fill="var(--muted)" font-size="7" text-anchor="middle" font-family="sans-serif">${v}</text>`).join('');
  const yTicks = axY.filter(v=>v!==68).map(v=>
    `<line x1="${f(PL-3)}" y1="${f(sy(v))}" x2="${f(PL)}" y2="${f(sy(v))}" stroke="var(--border)" stroke-width="1"/>
     <text x="${f(PL-5)}" y="${f(sy(v)+2.5)}" fill="var(--muted)" font-size="7" text-anchor="end" font-family="sans-serif">${v}</text>`).join('');

  // Chart: curated dots (always) + filtered mass dots with Ca+Bic
  const chartWaters = ALL_WATERS.filter(w =>
    w._curated || (visIds.has(w.id) && w.params.ca_hardness != null && w.params.alkalinity != null)
  );
  const dots = chartWaters.map(w => {
    const { ca_hardness: ca, alkalinity: alk } = w.params;
    if (ca == null || alk == null) return '';
    const cx = sx(alk), cy = sy(ca);
    const inView    = visIds.has(w.id);
    const isSel     = w.id === S.selectedId;
    const isCurated = w._curated;
    const opacity = inView ? (isCurated ? 0.9 : 0.65) : 0.1;
    const r      = isSel ? 8 : (isCurated ? 5.5 : 3);
    const stroke = isSel ? 'white' : 'var(--bg)';
    const sw     = isSel ? 2.5 : (isCurated ? 1 : 0.5);
    const tip = `${w.nom} (${w.pays})\n${w.label} — ${w.score != null ? Math.round(w.score*100)+'%' : 'N/A'}\nCa: ${ca.toFixed(0)} | Alk: ${alk.toFixed(0)} mg/L CaCO₃`;
    return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="${w.color}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${sw}" data-id="${_esc(w.id)}" style="cursor:pointer"><title>${_esc(tip)}</title></circle>`;
  }).join('');

  // Selected label
  const sel = S.selectedId ? WATERS.find(w => w.id === S.selectedId) : null;
  let selLabel = '';
  if (sel && sel.params.ca_hardness != null && sel.params.alkalinity != null) {
    const cx = sx(sel.params.alkalinity), cy = sy(sel.params.ca_hardness);
    const toRight = sel.params.alkalinity < 100, toBottom = sel.params.ca_hardness < 85;
    const lx = toRight ? cx + 10 : cx - 10;
    const ly = toBottom ? cy + 14 : cy - 7;
    selLabel = `<text x="${f(lx)}" y="${f(ly)}" fill="${sel.color}" font-size="8" font-weight="bold" font-family="sans-serif" text-anchor="${toRight ? 'start' : 'end'}">${_esc(sel.nom)}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible;display:block" id="sca-chart-svg">
    <rect width="${W}" height="${H}" fill="var(--bg)" rx="4"/>
    <!-- SCA zones -->
    <rect x="${f(sx(40))}" y="${f(sy(85))}" width="${f(sx(75)-sx(40))}" height="${f(sy(17)-sy(85))}" fill="var(--orange)" fill-opacity=".07" stroke="var(--orange)" stroke-width=".8" stroke-dasharray="3,2"/>
    <rect x="${f(sx(40))}" y="${f(sy(85))}" width="${f(sx(70)-sx(40))}" height="${f(sy(50)-sy(85))}" fill="var(--green)" fill-opacity=".11" stroke="var(--green)" stroke-width="1"/>
    <text x="${f(sx(55))}" y="${f(sy(67.5)+18)}" fill="var(--green)" fill-opacity=".6" font-size="8" font-weight="bold" text-anchor="middle" font-family="sans-serif">Idéal SCA</text>
    <!-- Grid -->
    ${gridLines}
    <line x1="${f(PL)}" y1="${f(PT+CH)}" x2="${f(PL+CW)}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>
    <line x1="${f(PL)}" y1="${f(PT)}" x2="${f(PL)}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>
    ${xTicks}${yTicks}
    <!-- Axis labels -->
    <text x="${f(PL+CW/2)}" y="${f(H-5)}" fill="var(--muted)" font-size="8" text-anchor="middle" font-family="sans-serif">Alcalinité (mg/L CaCO₃)</text>
    <text x="10" y="${f(PT+CH/2)}" fill="var(--muted)" font-size="8" text-anchor="middle" font-family="sans-serif" transform="rotate(-90,10,${f(PT+CH/2)})">Ca Hardness (mg/L CaCO₃)</text>
    <!-- SCA target -->
    <circle cx="${f(sx(55))}" cy="${f(sy(68))}" r="4" fill="var(--green)" fill-opacity=".5"/>
    <text x="${f(sx(55)+6)}" y="${f(sy(68)-5)}" fill="var(--green)" fill-opacity=".8" font-size="6.5" font-family="sans-serif">Cible 55/68</text>
    <!-- Waters -->
    ${dots}
    ${selLabel}
  </svg>`;
}

// ── Filters ───────────────────────────────────────────────────────────────────
function pill(label, active, key, val, group) {
  const cls = active ? 'season-pill active' : 'season-pill';
  return `<button class="${cls}" data-filter-group="${group}" data-filter-val="${_esc(String(val))}">${_esc(label)}</button>`;
}

function renderFilters() {
  const scoreOpts = [['Idéal ≥75%','ideal'],['Acceptable','accept'],['Hors plage','hors'],['Très hors SCA','tres']];
  const catOpts   = [...new Set(WATERS.map(w=>w.categorie))].sort();
  const typeOpts  = ['Plate','Gazeuse'];
  const durOpts   = [['Très douce <17','tres_douce'],['Douce 17–50','douce'],['Idéale SCA 50–85','ideale'],['Dure 85–170','dure'],['Très dure >170','tres_dure']];

  const cnt   = filtered().length;
  const total = ALL_WATERS.length;
  const loadBadge = massLoaded
    ? `<span class="b-count">${total.toLocaleString('fr-FR')} réf.</span>`
    : `<span class="b-count b-count-loading">⏳ Chargement…</span>`;
  return `
  <div class="b-filter-bar">
    <div class="b-search-row">
      <input id="b-search" type="text" placeholder="🔍  Rechercher eau, pays, source…" value="${_esc(S.search)}" autocomplete="off">
      <span class="b-count">${cnt.toLocaleString('fr-FR')} résultat${cnt!==1?'s':''}</span>
      ${loadBadge}
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Note SCA</span>
      <div class="season-pills">${scoreOpts.map(([l,v])=>pill(l,S.scoreRange.has(v),'scoreRange',v,'scoreRange')).join('')}</div>
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Type</span>
      <div class="season-pills">${typeOpts.map(v=>pill(v,S.type.has(v),'type',v,'type')).join('')}</div>
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Catégorie</span>
      <div class="season-pills">${catOpts.map(v=>pill(v,S.categorie.has(v),'categorie',v,'categorie')).join('')}</div>
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Dureté Ca</span>
      <div class="season-pills">${durOpts.map(([l,v])=>pill(l,S.durete.has(v),'durete',v,'durete')).join('')}</div>
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Pays</span>
      <div class="season-pills b-pays-pills">${allPays().map(v=>pill(v,S.pays.has(v),'pays',v,'pays')).join('')}</div>
    </div>
  </div>`;
}

// ── Table ─────────────────────────────────────────────────────────────────────
const COLS = [
  { key:'nom',         label:'Nom',                   align:'left'  },
  { key:'pays',        label:'Pays',                  align:'left'  },
  { key:'score',       label:'Note SCA',              align:'right' },
  { key:'ca_hardness', label:'Ca Hardness',           align:'right' },
  { key:'alkalinity',  label:'Alcalinité',            align:'right' },
  { key:'ph',          label:'pH',                    align:'right' },
  { key:'tds',         label:'TDS',                   align:'right' },
  { key:'na',          label:'Na',                    align:'right' },
];

function cellVal(w, key) {
  switch (key) {
    case 'nom':         return _esc(w.nom);
    case 'pays':        return `<span class="b-type-badge">${_esc(w.type_eau[0])}</span> ${_esc(w.pays)}`;
    case 'score':
      if (w.score == null) return '<span class="b-val-na">—</span>';
      return `<span class="b-score-badge" style="background:${w.color}22;color:${w.color};border:1px solid ${w.color}55">${Math.round(w.score*100)}&thinsp;%</span>`;
    case 'ca_hardness': return w.params.ca_hardness != null ? `<span style="color:var(--text)">${w.params.ca_hardness.toFixed(0)}</span><span class="b-unit"> CaCO₃</span>` : '<span class="b-val-na">—</span>';
    case 'alkalinity':  return w.params.alkalinity  != null ? `<span style="color:var(--text)">${w.params.alkalinity.toFixed(0)}</span><span class="b-unit"> CaCO₃</span>` : '<span class="b-val-na">—</span>';
    case 'ph':          return w.ph  != null ? `<span style="color:var(--text)">${w.ph.toFixed(1)}</span>` : '<span class="b-val-na">—</span>';
    case 'tds':         return w.tds_mg_l != null ? `<span style="color:var(--text)">${w.tds_mg_l.toFixed(0)}</span><span class="b-unit"> mg/L</span>` : '<span class="b-val-na">—</span>';
    case 'na':          return w.sodium_mg_l != null ? `<span style="color:var(--text)">${w.sodium_mg_l.toFixed(1)}</span><span class="b-unit"> mg/L</span>` : '<span class="b-val-na">—</span>';
    default:            return '—';
  }
}

function renderDetail(w) {
  const p = w.params;
  const fmt = (v, dec=1) => v != null ? v.toFixed(dec) : '—';
  const paramRow = (label, val, unit='mg/L', inRange=null) => {
    const cls = inRange === true ? 'b-det-ok' : inRange === false ? 'b-det-warn' : '';
    return `<div class="b-det-row ${cls}"><span class="b-det-label">${label}</span><span class="b-det-val">${val != null ? val : '—'}${val != null && unit ? '<span class="b-unit"> '+unit+'</span>' : ''}</span></div>`;
  };
  const inSca = (v, lo, hi) => v != null ? (v >= lo && v <= hi) : null;

  const coffeeRec = () => {
    const tips = [];
    const ca = p.ca_hardness, alk = p.alkalinity;
    if (ca == null || alk == null) return '';
    if (ca >= 50 && ca <= 85 && alk >= 40 && alk <= 70)
      tips.push('✓ Profil SCA idéal — convient à toutes les méthodes');
    else if (ca < 30)
      tips.push('↑ Eau douce — favoriser l\'immersion (cafetière, cold brew)');
    else if (ca > 170)
      tips.push('↓ Eau très dure — préférer l\'espresso court, risque de calcaire');
    if (alk > 100)
      tips.push('↓ Alcalinité élevée — favoriser cafés fruités, éviter torréfactions claires');
    else if (alk < 30)
      tips.push('↑ Faible alcalinité — préférer torréfactions medium');
    if (w.tds_mg_l != null && w.tds_mg_l > 300)
      tips.push(`⚠ TDS élevé (${Math.round(w.tds_mg_l)} mg/L) — température réduite 88–91°C`);
    if (!tips.length) return '';
    return `<div class="b-det-section"><div class="b-det-title">Recommandations café</div>${tips.map(t=>`<div class="b-recipe-tip">${_esc(t)}</div>`).join('')}</div>`;
  };

  return `<div class="b-detail">
    <div class="b-det-header">
      <div>
        <div class="b-det-name">${_esc(w.nom)}</div>
        <div class="b-det-origin">${_esc(w.ville_origine)} · ${_esc(w.entreprise)}</div>
        <div class="b-det-type">${_esc(w.categorie)} · ${_esc(w.type_eau)}</div>
      </div>
      <div class="b-det-score" style="color:${w.color}">
        <div class="b-det-score-val">${w.score != null ? Math.round(w.score*100)+'%' : '—'}</div>
        <div class="b-det-score-lbl">${_esc(w.label)}</div>
      </div>
    </div>
    <div class="b-det-desc">${_esc(w.description)}</div>
    <div class="b-det-params">
      <div class="b-det-section">
        <div class="b-det-title">Paramètres SCA (unités CaCO₃)</div>
        ${paramRow('Ca Hardness', p.ca_hardness != null ? p.ca_hardness.toFixed(0) : null, 'mg/L CaCO₃', inSca(p.ca_hardness,50,85))}
        ${paramRow('Alcalinité',  p.alkalinity  != null ? p.alkalinity.toFixed(0)  : null, 'mg/L CaCO₃', inSca(p.alkalinity,40,70))}
        ${paramRow('pH',          w.ph  != null ? w.ph.toFixed(1)  : null, '', inSca(w.ph,6.5,7.5))}
        ${paramRow('TDS',         w.tds_mg_l != null ? Math.round(w.tds_mg_l).toString() : null, 'mg/L', inSca(w.tds_mg_l,75,250))}
        ${paramRow('Sodium',      w.sodium_mg_l != null ? w.sodium_mg_l.toFixed(1) : null, 'mg/L', inSca(w.sodium_mg_l,0,30))}
        ${paramRow('Chlorures',   w.chlorure_mg_l != null ? w.chlorure_mg_l.toFixed(1) : null, 'mg/L', inSca(w.chlorure_mg_l,0,75))}
      </div>
      <div class="b-det-section">
        <div class="b-det-title">Composition brute (étiquette)</div>
        ${paramRow('Calcium (Ca)',    w.calcium_mg_l != null ? w.calcium_mg_l.toFixed(1) : null)}
        ${paramRow('Magnésium (Mg)', w.magnesium_mg_l != null ? w.magnesium_mg_l.toFixed(1) : null)}
        ${paramRow('Potassium (K)',   w.potassium_mg_l != null ? w.potassium_mg_l.toFixed(1) : null)}
        ${paramRow('Bicarbonates',    w.bicarbonate_mg_l != null ? w.bicarbonate_mg_l.toFixed(0) : null)}
        ${paramRow('Sulfates',        w.sulfate_mg_l != null ? w.sulfate_mg_l.toFixed(0) : null)}
        ${paramRow('Silice',          w.silice_mg_l != null ? w.silice_mg_l.toFixed(1) : null)}
        ${paramRow('Nitrates',        w.nitrate_mg_l != null ? w.nitrate_mg_l.toFixed(1) : null)}
      </div>
    </div>
    ${coffeeRec()}
  </div>`;
}

function renderTable(vis) {
  const allSorted = sorted(vis);
  const total  = allSorted.length;
  const pages  = Math.max(1, Math.ceil(total / S.perPage));
  const page   = Math.min(S.page, pages - 1);
  const start  = page * S.perPage;
  const slice  = allSorted.slice(start, start + S.perPage);

  const rows = slice.map(w => {
    const isSel = w.id === S.selectedId;
    const cells = COLS.map(c =>
      `<td style="text-align:${c.align}">${cellVal(w, c.key)}</td>`).join('');
    const row = `<tr class="b-row${isSel?' b-row-sel':''}" data-id="${_esc(w.id)}">${cells}</tr>`;
    const detail = isSel ? `<tr class="b-detail-row"><td colspan="${COLS.length}">${renderDetail(w)}</td></tr>` : '';
    return row + detail;
  }).join('');

  const thSort = col => {
    const isActive = S.sortCol === col.key;
    const arrow = isActive ? (S.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="b-th${isActive?' b-th-active':''}" data-sort="${col.key}" style="text-align:${col.align}">${_esc(col.label)}${arrow}</th>`;
  };

  // Pagination footer
  const from = total === 0 ? 0 : start + 1;
  const to   = Math.min(start + S.perPage, total);
  const pager = `<div class="b-pager">
    <button class="b-pager-btn" data-page="${page-1}" ${page===0?'disabled':''}>←</button>
    <span class="b-pager-info">${from.toLocaleString('fr-FR')}–${to.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')}</span>
    <button class="b-pager-btn" data-page="${page+1}" ${page>=pages-1?'disabled':''}>→</button>
  </div>`;

  const noResults = `<tr><td colspan="${COLS.length}" class="b-no-results">Aucune eau ne correspond aux filtres</td></tr>`;

  return `<div class="b-table-wrap">
    <table class="b-table">
      <thead><tr>${COLS.map(thSort).join('')}</tr></thead>
      <tbody>${rows || noResults}</tbody>
    </table>
    ${total > S.perPage ? pager : ''}
  </div>`;
}

// ── Full render ───────────────────────────────────────────────────────────────
function render() {
  const vis = filtered();
  document.getElementById('chart-container').innerHTML  = renderChart(vis);
  document.getElementById('filter-container').innerHTML = renderFilters();
  document.getElementById('table-container').innerHTML  = renderTable(vis);

  // Scroll to detail row if selected
  if (S.selectedId) {
    const sel = document.querySelector('.b-row-sel');
    if (sel) sel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── Event delegation ──────────────────────────────────────────────────────────
document.getElementById('chart-container').addEventListener('click', e => {
  const dot = e.target.closest('[data-id]');
  if (!dot) return;
  const id = dot.dataset.id;
  S.selectedId = S.selectedId === id ? null : id;
  render();
});

document.getElementById('filter-container').addEventListener('click', e => {
  const btn = e.target.closest('[data-filter-group]');
  if (!btn) return;
  const group = btn.dataset.filterGroup;
  const val   = btn.dataset.filterVal;
  const set   = S[group];
  set.has(val) ? set.delete(val) : set.add(val);
  S.page = 0;
  render();
});

document.getElementById('filter-container').addEventListener('input', e => {
  if (e.target.id === 'b-search') { S.search = e.target.value; S.page = 0; render(); }
});

document.getElementById('table-container').addEventListener('click', e => {
  const th = e.target.closest('[data-sort]');
  if (th) {
    const col = th.dataset.sort;
    if (S.sortCol === col) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
    else { S.sortCol = col; S.sortDir = col === 'nom' || col === 'pays' ? 'asc' : 'desc'; }
    S.page = 0;
    render();
    return;
  }
  const pgBtn = e.target.closest('[data-page]');
  if (pgBtn && !pgBtn.disabled) {
    S.page = parseInt(pgBtn.dataset.page, 10);
    render();
    document.getElementById('table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const row = e.target.closest('.b-row');
  if (row) {
    const id = row.dataset.id;
    S.selectedId = S.selectedId === id ? null : id;
    render();
  }
});

// ── Curated data loader ──────────────────────────────────────────────────────
async function loadCuratedData() {
  try {
    const resp = await fetch('curated_waters.json');
    const raw  = await resp.json();
    WATERS     = raw.map(w => computeEntry(w, true));
    ALL_WATERS = [...WATERS];
    render();
  } catch (e) {
    console.error('Failed to load curated_waters.json:', e);
    render();
  }
  loadMassData();
}

// ── Mass data loader ─────────────────────────────────────────────────────────
async function loadMassData() {
  try {
    const resp = await fetch('eaux_masse.json');
    const raw  = await resp.json();
    ALL_WATERS = [...WATERS, ...raw.map(w => computeEntry(w, false))];
    massLoaded = true;
    S.page = 0;
    render();
  } catch (e) {
    console.error('Failed to load mass data:', e);
    massLoaded = true;
    render();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
render();
loadCuratedData();
