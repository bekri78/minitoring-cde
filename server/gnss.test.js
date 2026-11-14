'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gnss-'));
const g = require('./gnss');
const { latLngToCell } = require('h3-js');

const BALTIC = latLngToCell(57.5, 21.0, 4);   // Baltique
const GULF   = latLngToCell(26.0, 56.0, 4);   // Golfe persique
const row = (h, low, total) => ({ h3Index: h, granularity: 'DAILY', lowQualityCount: low, totalAircraftCount: total });

test('heatmap : seuils (≥ 10 avions, ≥ 10 %), cumul par hexagone, contour, niveau, région', () => {
  const cells = g._reduceHeatmap([
    row(BALTIC, 6, 10), row(BALTIC, 4, 10),        // 10/20 = 50 % → fort
    row(GULF, 3, 12),                              // 25 % → moyen
    row(latLngToCell(48.8, 2.3, 4), 1, 50),        // 2 % → écarté
    row(latLngToCell(40, -100, 4), 5, 6),          // trop peu d'avions → écarté
    row('pas-un-h3', 9, 9),
  ]);
  assert.deepEqual(cells.map(c => c.level), ['fort', 'moyen']);
  const b = cells[0];
  assert.equal(b.pct, 50); assert.equal(b.low, 10); assert.equal(b.total, 20);
  assert.equal(b.region, 'Baltique'); assert.equal(cells[1].region, 'Golfe persique');
  assert.equal(b.b.length, 6);
  assert.ok(Math.abs(b.lat - 57.5) < 0.3 && Math.abs(b.lon - 21) < 0.3);
});

test('événements : brouillage et leurrage normalisés, triés par vols touchés', () => {
  const ev = g._reduceEvents([
    { eventId: '1', latitude: 43.6, longitude: 27.4, startTime: '2026-11-10T00:00:00.000Z', endTime: '2026-11-10T23:00:00.000Z', date: '2026-11-10', numFltAffected: 12 },
    { eventId: '2', latitude: 22.9, longitude: 48.1, date: '2026-11-10', numFltAffected: 900 },
    { eventId: '3', latitude: 'x', longitude: 1 },
  ], 'jam');
  assert.deepEqual(ev.map(e => e.id), ['gnss-jam-2026-11-10-2', 'gnss-jam-2026-11-10-1']);
  assert.equal(ev[1].region, 'Mer Noire – Ukraine'); assert.equal(ev[1].kind, 'jam');
});

test('EASA : tableau 7 jours, date, drapeaux leurrage / signalé', () => {
  const html = '<h2 class="center">impacted FIRs in the last 7 days on 14/10/2026</h2><table><tbody>'
    + '<tr class="eur-row"><td class="col-rank">1</td><td class="col-region">EUR</td><td class="col-icao">LTAA</td><td class="col-name">ANKARA</td><td class="col-spoofing">*</td><td class="col-reported">*</td></tr>'
    + '<tr class="eur-row"><td class="col-rank">2</td><td class="col-region">EUR</td><td class="col-icao">EETT</td><td class="col-name">TALLINN</td><td class="col-spoofing">&nbsp;</td><td class="col-reported">*</td></tr>'
    + '</tbody></table><h2 class="center">impacted FIRs in the last 30 days on 14/10/2026</h2><table><tr><td class="col-icao">OEJD</td></tr></table>';
  const e = g._parseEasa(html);
  assert.equal(e.date, '2026-10-14');
  assert.deepEqual(e.firs.map(f => f.icao), ['LTAA', 'EETT']);
  assert.equal(e.firs[0].spoofing, true); assert.equal(e.firs[1].spoofing, false); assert.equal(e.firs[1].reported, true);
  assert.equal(g._parseEasa('<html>autre page</html>'), null);
});

test('récupération : dernier jour publié, pas de re-téléchargement du même jour, panne → cache conservé', async () => {
  g._reset();
  const now = new Date('2026-11-14T10:00:00Z');
  const asked = [];
  const easa = '<h2>impacted FIRs in the last 7 days on 14/10/2026</h2><table><tr><td class="col-rank">1</td><td class="col-region">EUR</td><td class="col-icao">EPWW</td><td class="col-name">WARSZAWA</td><td class="col-spoofing"></td><td class="col-reported">*</td></tr></table>';
  const ok = async (u) => {
    asked.push(u);
    if (u.includes('easa.europa.eu')) return { ok: true, status: 200, text: async () => easa };
    const json = d => ({ ok: true, status: 200, json: async () => ({ license: 'CC BY-NC 4.0', data: d }) });
    if (u.endsWith('jamming/2026/11/11/heatmap.json')) return json([row(BALTIC, 8, 10)]);
    if (u.endsWith('jamming/2026/11/11/events.json')) return json([{ eventId: '5', latitude: 57, longitude: 21, date: '2026-11-11', numFltAffected: 30 }]);
    if (u.endsWith('spoofing/2026/11/10/events.json')) return json([{ eventId: '9', latitude: 26, longitude: 56, date: '2026-11-10', numFltAffected: 4 }]);
    return { ok: false, status: 404 };
  };
  const c = await g.fetchGnss(ok, now);
  assert.equal(c.status, 'ok'); assert.equal(c.day, '2026/11/11'); assert.equal(c.spoofDay, '2026/11/10');
  assert.equal(c.cells.length, 1);
  assert.deepEqual(c.events.map(e => e.kind).sort(), ['jam', 'spoof']);
  assert.equal(c.firs[0].icao, 'EPWW'); assert.equal(c.easaDate, '2026-10-14');
  assert.ok(asked[0].endsWith('jamming/2026/11/13/heatmap.json'));   // hier d'abord

  asked.length = 0;
  await g.fetchGnss(ok, now);
  assert.ok(!asked.some(u => u.endsWith('2026/11/11/heatmap.json')), 'jour déjà en cache : pas retéléchargé');

  const ko = async () => { throw new Error('réseau coupé'); };
  const c3 = await g.fetchGnss(ko, new Date('2026-11-15T10:00:00Z'));
  assert.equal(c3.cells.length, 1); assert.equal(c3.status, 'stale'); assert.equal(c3.easaStatus, 'stale');
});
