'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const { computeRuptures, countsByKey, computeConvergences } = require('./insights');

// Fabrique n événements pour un pays / une catégorie
function evs(cc, n, category = 'conflict', extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: cc + category + i + Math.random(), countryCode: cc, country: 'Ville, ' + cc,
    category, lat: 30 + i * 0.01, lon: 50 + i * 0.01, score: i, ...extra,
  }));
}

// 28 jours de normale : Iran ~3/j, Russie ~20/j (variable), Japon absent
const baseline = Array.from({ length: 28 }, (_, d) =>
  countsByKey([...evs('IR', 2 + (d % 3)), ...evs('RU', 18 + (d % 5)), ...evs('UA', 10 + (d % 4), 'military')]));

test('ruptures : hausse nette détectée, variation normale ignorée', () => {
  const today = [...evs('IR', 15), ...evs('RU', 22), ...evs('UA', 12, 'military')];
  const r = computeRuptures(today, baseline);
  const ids = r.map(x => x.id);
  assert.ok(ids.includes('rupture-IR-conflict'), 'Iran ×5 doit ressortir (catégorie précise)');
  assert.ok(!ids.includes('rupture-IR-all'), 'pas de doublon pays + catégorie');
  assert.ok(!ids.some(i => i.startsWith('rupture-RU')), 'Russie dans sa normale');
  assert.ok(!ids.some(i => i.startsWith('rupture-UA')), 'Ukraine dans sa normale');
  const ir = r.find(x => x.id === 'rupture-IR-conflict');
  assert.strictEqual(ir.today, 15);
  assert.ok(ir.ratio >= 4 && ir.z >= 2);
  assert.ok(typeof ir.lat === 'number' && ir.eventIds.length === 5);
});

test('ruptures : émergence d\'un pays absent de la normale, avec seuil plus haut', () => {
  assert.ok(computeRuptures(evs('JP', 9), baseline).some(x => x.id === 'rupture-JP-conflict' && x.kind === 'emergence'));
  assert.strictEqual(computeRuptures(evs('JP', 5), baseline).length, 0, '5 événements : pas assez');
});

test('ruptures : pas de verdict sans historique suffisant', () => {
  assert.deepStrictEqual(computeRuptures(evs('IR', 30), baseline.slice(0, 3)), []);
});

test('convergences : air + anomalie AIS + événement au même endroit', () => {
  const c = computeConvergences({
    tracks: [{ id: 'a1', domain: 'air', milTier: 'confirmed_military', lat: 26.5, lon: 56.2, callsign: 'RCH123' }],
    anomalies: [{ id: 'x1', type: 'ais_gap', lat: 26.8, lon: 56.5 }],
    events: [{ id: 'e1', category: 'military', lat: 27.1, lon: 56.3, title: 'Détroit d\'Ormuz', country: 'Bandar Abbas, Iran' }],
    news: [],
  });
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual(c[0].types.sort(), ['air', 'ais', 'event']);
  assert.strictEqual(c[0].label, 'Iran');
});

test('convergences : rien sans signal physique, rien à 2 types, pêche ignorée', () => {
  assert.strictEqual(computeConvergences({
    events: [{ id: 'e', category: 'conflict', lat: 10, lon: 10 }], news: [{ id: 'n', lat: 10.2, lon: 10.1 }],
    tracks: [], anomalies: [{ id: 'f', type: 'fishing_activity', lat: 10.1, lon: 10.1 }],
  }).length, 0);
  assert.strictEqual(computeConvergences({
    tracks: [{ id: 's', domain: 'sea', milTier: 'confirmed_military', lat: 40, lon: 20 }],
    news: [{ id: 'n', lat: 40.1, lon: 20.1 }], events: [], anomalies: [],
  }).length, 0);
});

test('convergences : deux foyers éloignés restent distincts, voisins fusionnés', () => {
  const site = (lat, lon, p) => ({
    tracks: [{ id: p + 'a', domain: 'air', milTier: 'likely_military', lat, lon }],
    anomalies: [{ id: p + 'x', type: 'encounter', lat: lat + 0.3, lon }],
    events: [{ id: p + 'e', category: 'conflict', lat, lon: lon + 0.3 }],
  });
  const a = site(26, 56, 'A'), b = site(50, 30, 'B');
  const c = computeConvergences({
    tracks: [...a.tracks, ...b.tracks], anomalies: [...a.anomalies, ...b.anomalies],
    events: [...a.events, ...b.events], news: [],
  });
  assert.strictEqual(c.length, 2);
});

test('ruptures : total pays gardé quand la hausse est répartie entre catégories', () => {
  const today = [...evs('IR', 6, 'conflict'), ...evs('IR', 6, 'military'), ...evs('IR', 6, 'protest')];
  const r = computeRuptures(today, baseline);
  assert.ok(r.some(x => x.id === 'rupture-IR-all'));
});
