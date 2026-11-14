'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.CACHE_DIR = require('os').tmpdir() + '/firms-test-' + process.pid;
const f = require('./firms');
const CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
48.01,37.81,360,0.4,0.4,2026-11-14,0112,N,VIIRS,h,2.0NRT,300,140.2,N
48.02,37.82,350,0.4,0.4,2026-11-14,0112,N,VIIRS,h,2.0NRT,300,20.1,N
48.03,37.83,340,0.4,0.4,2026-11-14,0230,N,VIIRS,n,2.0NRT,300,25,N
30.5,47.8,330,0.4,0.4,2026-11-14,1030,N,VIIRS,l,2.0NRT,300,500,D
30.1,47.1,330,0.4,0.4,2026-11-14,1030,N,VIIRS,h,2.0NRT,300,5,D`;
test('parse + agrégation par cellule', () => {
  const rows = f._parseCsv(CSV);
  assert.strictEqual(rows.length, 5);
  const cells = f._aggregate(rows, 'Ukraine – Russie');
  const c = cells.find(x => x.count === 3);
  assert.ok(c, 'les 3 détections proches sont regroupées');
  assert.strictEqual(c.frpMax, 140); assert.strictEqual(c.level, 'fort'); assert.strictEqual(c.night, true);
  assert.strictEqual(c.last, '2026-11-14T02:30:00Z');
  assert.ok(!cells.some(x => x.frpMax === 500), 'confiance basse écartée');
});
test('sélection : petits foyers isolés écartés', () => {
  const sel = f._select(f._aggregate(f._parseCsv(CSV), 'z'));
  assert.strictEqual(sel.length, 1);
});
test('fetch : sans clé → no-key ; avec clé → cellules', async () => {
  assert.strictEqual((await f.fetchFirms(async () => { throw new Error('x'); }, '')).status, 'no-key');
  const urls = [];
  const c = await f.fetchFirms(async u => { urls.push(u); return { ok: true, status: 200, text: async () => CSV }; }, 'K');
  assert.strictEqual(c.status, 'ok'); assert.strictEqual(c.cells.length, 1);
  assert.strictEqual(urls.length, f.ZONES.length * 2);
  assert.ok(urls[0].includes('/K/VIIRS_SNPP_NRT/22,44,50,58/1'));
});
