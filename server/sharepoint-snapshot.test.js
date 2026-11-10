'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const zlib   = require('zlib');
const { buildSnapshot, validateSnapshot, createSnapshotHandler } = require('./sharepoint-snapshot');

const events = [
  { id: 'e1', title: 'A', url: 'u1', canonical_url: 'u1', editorial_dedup_key: 'k', text_blob: 'x', _score: 3, lat: 1, lon: 2 },
  { id: 'e2', title: 'B', url: 'u2', canonical_url: 'u2-autre', lat: 3, lon: 4 },
];

const src = {
  osint:             () => ({ events, lastUpdate: '2026-11-10T10:00:00Z', status: 'ok' }),
  news:              () => ({ events: [{ id: 'n1', title: 'N' }], lastUpdate: '2026-11-10T10:00:00Z' }),
  signals:           () => ({ signals: [], lastUpdate: null }),
  signalMarkers:     () => ({ markers: [] }),
  worldEvents:       () => ({ events: [] }),
  tracks:            () => ({
    tracks: [{ id: 't1', lat: 1, lon: 2, _raw: { big: true }, nearbyEvents: [{ id: 'e1', title: 'A', distanceKm: 12 }] }],
    meta: { shipStream: { status: 'ok', lastUpdate: '2026-11-10T10:00:00Z' } },
  }),
  maritimeEvents:    () => [],
  maritimeAnomalies: () => ({ anomalies: [], meta: { status: 'ok' } }),
  aviationEvents:    () => [],
  spatialEvents:     () => [],
  earthquakes:       () => ({ quakes: [{ id: 'q1' }] }),
  spaceWeather:      () => ({ kp: 2, scales: {}, alerts: [] }),
  launches:          () => ({ launches: [] }),
  decay:             () => ({ objects: [] }),
  tip:               () => ({ objects: [] }),
  history:           () => [{ id: '20261110', date: '20261110', count: 2 }],
};

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.status = c => { r.statusCode = c; return r; };
  r.set = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.send = b => { r.body = b; return r; };
  r.json = b => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const req = (query = {}, ae = '') => ({ query, get: h => (h.toLowerCase() === 'accept-encoding' ? ae : undefined) });

test('allège événements et pistes', () => {
  const s = buildSnapshot(src);
  assert.deepStrictEqual(Object.keys(s.data.osint[0]).sort(), ['id', 'lat', 'lon', 'title', 'url']);
  assert.strictEqual(s.data.osint[1].canonical_url, 'u2-autre'); // conservé s'il diffère
  assert.strictEqual(s.data.tracks[0]._raw, undefined);
  assert.strictEqual(s.data.tracks[0].nearbyEvents, undefined);
  assert.deepStrictEqual(s.data.tracks[0].nearbyEventRefs, [{ id: 'e1', distanceKm: 12 }]);
  assert.deepStrictEqual(validateSnapshot(s), []);
});

test('ETag stable si le contenu ne change pas', () => {
  assert.strictEqual(buildSnapshot(src).etag, buildSnapshot(src).etag);
});

test('validation : doublons, base vide, compteurs', () => {
  const s = buildSnapshot(src);
  s.data.osint.push({ ...s.data.osint[0] });
  s.counts.osint = s.data.osint.length;
  assert.ok(validateSnapshot(s).some(e => e.includes('double')));

  const empty = buildSnapshot({ ...src, osint: () => ({ events: [] }), news: () => ({ events: [] }) });
  assert.ok(validateSnapshot(empty).some(e => e.includes('aucun')));

  const bad = buildSnapshot(src);
  bad.counts.news = 99;
  assert.ok(validateSnapshot(bad).some(e => e.includes('incohérent')));
});

test('route : 200 gzip, puis 304 avec l\'ETag connu', () => {
  const handler = createSnapshotHandler(src);
  const r1 = fakeRes();
  handler(req({}, 'gzip, deflate, br'), r1);
  assert.strictEqual(r1.statusCode, 200);
  assert.strictEqual(r1.headers['content-encoding'], 'gzip');
  const body = JSON.parse(zlib.gunzipSync(r1.body).toString());
  assert.strictEqual(body.type, 'ogma-snapshot');

  const r2 = fakeRes();
  handler(req({ etag: body.etag }), r2);
  assert.strictEqual(r2.statusCode, 304);
  assert.strictEqual(r2.body, undefined);

  const r3 = fakeRes();
  handler(req({ etag: 'ancien' }), r3);
  assert.strictEqual(r3.statusCode, 200);
  assert.strictEqual(JSON.parse(r3.body).etag, body.etag); // sans gzip si non accepté
});

test('route : 503 si l\'instantané est invalide', () => {
  const handler = createSnapshotHandler({ ...src, osint: () => ({ events: [] }), news: () => ({ events: [] }) });
  const r = fakeRes();
  handler(req(), r);
  assert.strictEqual(r.statusCode, 503);
});
