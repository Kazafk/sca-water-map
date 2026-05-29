import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFromParams, labelFromScore, colorFromScore, flagsFromParams } from '../public/scoring.js';

test('scoreFromParams: ideal water (Ca=68, Alk=55) scores > 0.95', () => {
  const s = scoreFromParams({ ca_hardness: 68, alkalinity: 55, ph: 7.0, tds: 150, na: 10, cl: 20, cl2: 0 });
  assert.ok(s > 0.95, `expected > 0.95, got ${s}`);
});

test('scoreFromParams: Paris water (Ca=244, Alk=209) scores < 0.25', () => {
  const s = scoreFromParams({ ca_hardness: 244, alkalinity: 209, ph: 7.8, tds: 400, na: 15, cl: 50, cl2: 0.1 });
  assert.ok(s < 0.25, `expected < 0.25, got ${s}`);
});

test('scoreFromParams: missing both Ca and Alk returns null', () => {
  assert.equal(scoreFromParams({ ca_hardness: null, alkalinity: null, ph: 7.0, tds: 150, na: 10, cl: 20, cl2: 0 }), null);
});

test('scoreFromParams: Ca-only (1D) returns a score', () => {
  const s = scoreFromParams({ ca_hardness: 68, alkalinity: null, ph: 7.0, tds: 150, na: 10, cl: 20, cl2: 0 });
  assert.ok(s !== null && s > 0.9);
});

test('scoreFromParams: Alk-only (1D) returns a score', () => {
  const s = scoreFromParams({ ca_hardness: null, alkalinity: 55, ph: 7.0, tds: 150, na: 10, cl: 20, cl2: 0 });
  assert.ok(s !== null && s > 0.9);
});

test('labelFromScore: correct label at each boundary', () => {
  assert.equal(labelFromScore(1.00), 'Idéal SCA');
  assert.equal(labelFromScore(0.75), 'Idéal SCA');
  assert.equal(labelFromScore(0.74), 'Acceptable');
  assert.equal(labelFromScore(0.50), 'Acceptable');
  assert.equal(labelFromScore(0.49), 'Hors plage');
  assert.equal(labelFromScore(0.25), 'Hors plage');
  assert.equal(labelFromScore(0.24), 'Très hors SCA');
  assert.equal(labelFromScore(null), 'Données absentes');
});

test('colorFromScore: correct color at each boundary', () => {
  assert.equal(colorFromScore(0.75), '#2ecc71');
  assert.equal(colorFromScore(0.50), '#3498db');
  assert.equal(colorFromScore(0.25), '#f39c12');
  assert.equal(colorFromScore(0.24), '#e74c3c');
  assert.equal(colorFromScore(null), '#2d2d2d');
});

test('flagsFromParams: detects chlore_detected', () => {
  const params = { ca_hardness: 68, alkalinity: 55, cl2: 0.08, na: 10, cl: 20, ph: 7.0, tds: 150 };
  const dates  = Object.fromEntries(Object.keys(params).map(k => [k, '2026-03-01']));
  const flags  = flagsFromParams(params, dates, '2026-05-01T00:00:00Z');
  assert.ok(flags.includes('chlore_detected'));
  assert.ok(!flags.includes('data_old'));
});

test('flagsFromParams: detects data_old when a date is > 12 months before generated_at', () => {
  const params = { ca_hardness: 68, alkalinity: 55, cl2: 0, na: 10, cl: 20, ph: 7.0, tds: 150 };
  const dates  = { ca_hardness: '2024-01-01', alkalinity: '2026-03-01', cl2: '2026-03-01',
                   na: '2026-03-01', cl: '2026-03-01', ph: '2026-03-01', tds: '2026-03-01' };
  const flags  = flagsFromParams(params, dates, '2026-05-01T00:00:00Z');
  assert.ok(flags.includes('data_old'));
});

test('flagsFromParams: detects too_hard and too_alkaline for Paris-like water', () => {
  const params = { ca_hardness: 244, alkalinity: 209, cl2: 0, na: 15, cl: 50, ph: 7.8, tds: 400 };
  const dates  = Object.fromEntries(Object.keys(params).map(k => [k, '2026-03-01']));
  const flags  = flagsFromParams(params, dates, '2026-05-01T00:00:00Z');
  assert.ok(flags.includes('too_hard'));
  assert.ok(flags.includes('too_alkaline'));
});

test('flagsFromParams: detects too_soft for alpine water', () => {
  const params = { ca_hardness: 10, alkalinity: 8, cl2: 0, na: 2, cl: 3, ph: 6.8, tds: 20 };
  const dates  = Object.fromEntries(Object.keys(params).map(k => [k, '2026-03-01']));
  const flags  = flagsFromParams(params, dates, '2026-05-01T00:00:00Z');
  assert.ok(flags.includes('too_soft'));
});

test('scoreFromParams: negative cl2 (sensor noise) does not exceed 1.0', () => {
  const s = scoreFromParams({ ca_hardness: 68, alkalinity: 55, ph: 7.0, tds: 150, na: 10, cl: 20, cl2: -1.0 });
  assert.ok(s !== null && s >= 0 && s <= 1.0, `expected 0 <= score <= 1, got ${s}`);
});
