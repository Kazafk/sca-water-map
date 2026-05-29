// public/scoring.js

function _scoreRange(val, lo, hi, maxLo, maxHi) {
  if (val === null || val === undefined) return null;
  if (val >= lo && val <= hi) return 1.0;
  if (val < lo) {
    const span = lo - maxLo;
    return span > 0 ? Math.max(0, 1 - (lo - val) / span) : 0;
  }
  const span = maxHi - hi;
  return span > 0 ? Math.max(0, 1 - (val - hi) / span) : 0;
}

function _scoreChart(ca, alk) {
  if (ca != null && alk != null) {
    const dCa  = Math.abs(ca  - 68) / 85;
    const dAlk = Math.abs(alk - 55) / 75;
    return Math.max(0, 1 - Math.sqrt(dCa ** 2 + dAlk ** 2) / Math.sqrt(2));
  }
  if (ca  != null) return Math.max(0, 1 - Math.abs(ca  - 68) / 85);
  if (alk != null) return Math.max(0, 1 - Math.abs(alk - 55) / 75);
  return null;
}

export function scoreFromParams(params) {
  const { ca_hardness, alkalinity, ph, tds, na, cl, cl2 } = params;

  const sc = _scoreChart(ca_hardness, alkalinity);
  if (sc === null) return null;

  const secondaries = [
    [_scoreRange(ph,  6.5,  7.5,  0,   14), 0.08],
    [_scoreRange(tds,  75,  250,  0,  500), 0.06],
    [_scoreRange(na,    0,   30,  0,  100), 0.03],
    [_scoreRange(cl,    0,   75,  0,  200), 0.02],
    [cl2 != null ? Math.max(0, 1 - cl2 / 0.5) : null, 0.01],
  ];

  const avail  = secondaries.filter(([s]) => s !== null);
  const totalW = avail.reduce((sum, [, w]) => sum + w, 0);
  const secScore = totalW > 0
    ? avail.reduce((sum, [s, w]) => sum + s * w, 0) / totalW
    : 0;

  return Math.round((0.80 * sc + 0.20 * secScore) * 10000) / 10000;
}

export function labelFromScore(score) {
  if (score == null) return 'Données absentes';
  if (score >= 0.75) return 'Idéal SCA';
  if (score >= 0.50) return 'Acceptable';
  if (score >= 0.25) return 'Hors plage';
  return 'Très hors SCA';
}

export function colorFromScore(score) {
  if (score == null) return '#2d2d2d';
  if (score >= 0.75) return '#2ecc71';
  if (score >= 0.50) return '#3498db';
  if (score >= 0.25) return '#f39c12';
  return '#e74c3c';
}

export function flagsFromParams(params, dates, generatedAt) {
  const flags = [];
  const { ca_hardness, alkalinity, cl2 } = params;

  if (cl2 != null && cl2 > 0)                   flags.push('chlore_detected');
  if (ca_hardness != null && ca_hardness > 85)   flags.push('too_hard');
  if (ca_hardness != null && ca_hardness < 17)   flags.push('too_soft');
  if (alkalinity  != null && alkalinity  > 75)   flags.push('too_alkaline');

  const cutoff = new Date(generatedAt);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  if (dates && Object.values(dates).some(d => d && new Date(d) < cutoff))
    flags.push('data_old');

  return flags;
}
