'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'copernicus-'));
const c = require('./copernicus');

// Format réel de public-activations-info (14/11/2026)
const act = (code, extra = {}) => ({ code, countries: ['Panama'], eventTime: '2026-10-09T17:56:00', name: 'Earthquake in Los Santos, Panama',
  centroid: 'POINT (-80.67084785156302 8.006692455305457)', activationTime: '2026-10-09T23:19:00', category: 'Earthquake',
  lastUpdate: '2026-10-29T09:46:29', closed: true, gdacsId: 'EQ1570339', n_aois: 9, n_products: 13, ...extra });

test('normalisation : position (WKT lon lat), lien GDACS, catégorie, dates UTC, lien visionneuse', () => {
  const a = c._normalize(act('EMSR934'));
  assert.equal(a.lat, 8.007); assert.equal(a.lon, -80.671);
  assert.equal(a.gdacsRef, 'gdacs-EQ-1570339'); assert.equal(a.type, 'EQ'); assert.equal(a.categoryFr, 'Séisme');
  assert.equal(a.activationTime, '2026-10-09T23:19:00.000Z'); assert.equal(a.products, 13);
  assert.equal(a.url, 'https://rapidmapping.emergency.copernicus.eu/EMSR934');
  assert.equal(c._normalize(act('EMSR1', { gdacsId: null, centroid: '' })).gdacsRef, null);
  assert.equal(c._gdacsRef('TC 1001234'), 'gdacs-TC-1001234');
});

test('sélection : ouvertes toujours, closes de moins de 30 jours, plus récentes d’abord', () => {
  const now = Date.parse('2026-11-15T00:00:00Z');
  const out = c._select([
    act('EMSR900', { activationTime: '2026-08-01T00:00:00', closed: true }),     // trop ancienne
    act('EMSR935', { activationTime: '2026-10-19T16:03:00', closed: true }),     // 26 jours
    act('EMSR800', { activationTime: '2026-01-01T00:00:00', closed: false }),    // ancienne mais ouverte
  ], now);
  assert.deepEqual(out.map(a => a.code), ['EMSR935', 'EMSR800']);
});

test('récupération : liste paginée lue, panne → cache conservé', async () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ count: 1, next: null, results: [act('EMSR935', { activationTime: new Date().toISOString().slice(0, 19) })] }) });
  const r = await c.fetchCopernicus(ok);
  assert.equal(r.status, 'ok'); assert.equal(r.activations.length, 1);
  const r2 = await c.fetchCopernicus(async () => ({ ok: false, status: 502 }));
  assert.equal(r2.status, 'stale'); assert.equal(r2.activations.length, 1);
});
