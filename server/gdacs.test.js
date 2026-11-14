'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gdacs-'));
const g = require('./gdacs');

const feat = (type, id, level, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [45.1, 12.3] },
  properties: { eventtype: type, eventid: id, alertlevel: level, name: type + ' ' + id, country: 'Yemen', iso3: 'YEM',
    fromdate: '2026-11-10T00:00:00', todate: '2026-11-12T06:00:00', severitydata: { severitytext: 'Magnitude 6.1M' },
    url: { report: 'https://www.gdacs.org/report.aspx?eventid=' + id }, ...extra } });

test('normalisation : type, niveau, coordonnées, dates en UTC, lien du rapport', () => {
  const e = g._normalize(feat('TC', 1, 'Orange'));
  assert.equal(e.id, 'gdacs-TC-1'); assert.equal(e.typeFr, 'Cyclone'); assert.equal(e.level, 'orange');
  assert.equal(e.lat, 12.3); assert.equal(e.lon, 45.1); assert.equal(e.from, '2026-11-10T00:00:00.000Z');
  assert.equal(e.severity, 'Magnitude 6.1M'); assert.ok(e.url.includes('eventid=1'));
});

test('tri : petits séismes verts écartés, rouge avant orange avant vert, doublons fusionnés', () => {
  const out = g._select([feat('EQ', 2, 'Green'), feat('FL', 3, 'Green'), feat('EQ', 4, 'Red'), feat('VO', 5, 'Orange'), feat('VO', 5, 'Orange'),
    { properties: { eventtype: 'XX' } }]);
  assert.deepEqual(out.map(e => e.id), ['gdacs-EQ-4', 'gdacs-VO-5', 'gdacs-FL-3']);
});

test('récupération : URL de recherche, cache rempli ; panne : cache conservé', async () => {
  let url;
  const ok = async (u) => { url = u; return { ok: true, json: async () => ({ features: [feat('WF', 7, 'Red')] }) }; };
  const c = await g.fetchGdacs(ok);
  assert.ok(url.includes('geteventlist/SEARCH') && url.includes('eventlist=EQ;TC;FL;VO;DR;WF'));
  assert.equal(c.events.length, 1); assert.equal(c.status, 'ok');
  const ko = async () => ({ ok: false, status: 503 });
  const c2 = await g.fetchGdacs(ko);
  assert.equal(c2.events.length, 1); assert.equal(c2.status, 'stale');
});
