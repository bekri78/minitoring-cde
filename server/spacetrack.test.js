'use strict';

// Lignes au format réel de Space-Track (classes decay et tip)
const test   = require('node:test');
const assert = require('node:assert');
const { normalizeDecay, normalizeTip, selectDecay, latestPerObject } = require('./spacetrack');

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

test('DECAY : seuls les objets significatifs sont gardés, une prévision par objet', () => {
  const rows = [
    { NORAD_CAT_ID: '10', OBJECT_NAME: 'CZ-5B R/B', RCS_SIZE: 'LARGE', MSG_EPOCH: '2026-11-09 10:00:00' },
    { NORAD_CAT_ID: '10', OBJECT_NAME: 'CZ-5B R/B', RCS_SIZE: 'LARGE', MSG_EPOCH: '2026-11-10 10:00:00' },
    { NORAD_CAT_ID: '11', OBJECT_NAME: 'COSMOS 2251 DEB', RCS_SIZE: 'SMALL' },
    { NORAD_CAT_ID: '12', OBJECT_NAME: 'FENGYUN 1C DEB', RCS_SIZE: 'MEDIUM' },
    { NORAD_CAT_ID: '13', OBJECT_NAME: 'STARLINK-1234', RCS_SIZE: 'LARGE' },
    { NORAD_CAT_ID: '14', OBJECT_NAME: 'CUBESAT X', RCS_SIZE: 'SMALL' },
    { NORAD_CAT_ID: '15', OBJECT_NAME: 'COSMOS 2500', RCS_SIZE: 'MEDIUM' },
  ];
  const { kept, stats } = selectDecay(rows);
  assert.deepStrictEqual(kept.map(r => r.NORAD_CAT_ID), ['10', '15']);
  assert.strictEqual(kept[0].MSG_EPOCH, '2026-11-10 10:00:00');
  assert.deepStrictEqual(stats, { objects: 6, debris: 2, small: 1, starlink: 1 });
});

test('TIP : même objet, plusieurs bulletins → un seul, le plus récent', () => {
  const rows = [
    { NORAD_CAT_ID: '7', OBJECT_NAME: 'CZ-3B R/B', MSG_EPOCH: '2026-11-10 01:00:00', DECAY_EPOCH: '2026-11-11 03:00:00' },
    { NORAD_CAT_ID: '7', OBJECT_NAME: 'CZ-3B R/B', MSG_EPOCH: '2026-11-10 09:00:00', DECAY_EPOCH: '2026-11-11 05:30:00' },
    { NORAD_CAT_ID: '8', OBJECT_NAME: 'SL-4 R/B',  MSG_EPOCH: '2026-11-10 02:00:00', DECAY_EPOCH: '2026-11-11 08:00:00' },
  ];
  const out = latestPerObject(rows);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out.find(r => r.NORAD_CAT_ID === '7').DECAY_EPOCH, '2026-11-11 05:30:00');
});
