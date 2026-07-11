import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearchQuery, searchLocalCities } from '../public/world-search.js';

const SAMPLE = [
  { id: 'tokyo-JP',     name: 'Tokyo',     country: 'JP', country_name: 'Japan',   lat: 35.68, lng: 139.69, score: 0.77 },
  { id: 'vienna-AT',    name: 'Vienna',    country: 'AT', country_name: 'Austria', lat: 48.21, lng: 16.37,  score: 0.15 },
  { id: 'paris-FR',     name: 'Paris',     country: 'FR', country_name: 'France',  lat: 48.85, lng: 2.35,   score: 0.45 },
  { id: 'marseille-FR', name: 'Marseille', country: 'FR', country_name: 'France',  lat: 43.30, lng: 5.37,   score: 0.52 },
  { id: 'saopaulo-BR',  name: 'São Paulo', country: 'BR', country_name: 'Brazil',  lat: -23.5, lng: -46.6,  score: 0.44 },
];

test('normalizeSearchQuery: lowercase', () => {
  assert.equal(normalizeSearchQuery('Tokyo'), 'tokyo');
});

test('normalizeSearchQuery: diacritics removed', () => {
  assert.equal(normalizeSearchQuery('Tôkyô'), 'tokyo');
});

test('normalizeSearchQuery: trimmed', () => {
  assert.equal(normalizeSearchQuery('  Vienna  '), 'vienna');
});

test('normalizeSearchQuery: ã → a (São Paulo)', () => {
  assert.equal(normalizeSearchQuery('São'), 'sao');
});

test('normalizeSearchQuery: empty string', () => {
  assert.equal(normalizeSearchQuery(''), '');
});

test('searchLocalCities: finds Tokyo by name prefix', () => {
  const r = searchLocalCities(SAMPLE, 'tok');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'tokyo-JP');
});

test('searchLocalCities: finds both French cities by country prefix', () => {
  const r = searchLocalCities(SAMPLE, 'fr');
  assert.equal(r.length, 2);
});

test('searchLocalCities: sorted by score desc', () => {
  const r = searchLocalCities(SAMPLE, 'fr');
  assert.ok(r[0].score >= r[1].score);
});

test('searchLocalCities: single char query returns empty', () => {
  assert.equal(searchLocalCities(SAMPLE, 'x').length, 0);
});

test('searchLocalCities: empty query returns empty', () => {
  assert.equal(searchLocalCities(SAMPLE, '').length, 0);
});

test('searchLocalCities: diacritic-insensitive match (São Paulo)', () => {
  const r = searchLocalCities(SAMPLE, 'sao');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'saopaulo-BR');
});

test('searchLocalCities: limit is respected', () => {
  const r = searchLocalCities(SAMPLE, 'fr', 1);
  assert.equal(r.length, 1);
});
