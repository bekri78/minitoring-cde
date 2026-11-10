'use strict';

// Lignes au format réel de Space-Track (classes decay et tip)
const test   = require('node:test');
const assert = require('node:assert');
const { normalizeDecay, normalizeTip } = require('./spacetrack');

const inDays = d => new Date(Date.now() + d * 86400000).toISOString().replace('T', ' ').slice(0, 19);

test('decay : le pays est lu dans COUNTRY (et non COUNTRY_CODE)', () => {
  const o = normalizeDecay({ NORAD_CAT_ID: '58123', OBJECT_NAME: 'STARLINK-1234', COUNTRY: 'US', DECAY_EPOCH: inDays(4), MSG_TYPE: 'Prediction' });
  assert.ok(o, 'objet conservé');
  assert.strictEqual(o.country, 'US');
  assert.strictEqual(o.name, 'STARLINK-1234');
  assert.ok(typeof o.lat === 'number' && typeof o.lon === 'number');
});

test('decay : un pays sans coordonnées connues n\'écarte plus l\'objet', () => {
  const o = normalizeDecay({ NORAD_CAT_ID: '1', OBJECT_NAME: 'DEB', COUNTRY: 'XYZ', DECAY_EPOCH: inDays(2) });
  assert.ok(o);
  assert.strictEqual(o.lat, null);
});

test('decay : une rentrée passée depuis plus de 6 h reste écartée', () => {
  assert.strictEqual(normalizeDecay({ NORAD_CAT_ID: '2', COUNTRY: 'US', DECAY_EPOCH: inDays(-1) }), null);
});

test('tip : coordonnées et pays', () => {
  const o = normalizeTip({ NORAD_CAT_ID: '3', LAT: '12.5', LON: '-40.2', DECAY_EPOCH: inDays(1), COUNTRY: 'PRC', HIGH_INTEREST: 'Y' });
  assert.strictEqual(o.lat, 12.5);
  assert.strictEqual(o.country, 'PRC');
  assert.ok(o.highInterest);
});
