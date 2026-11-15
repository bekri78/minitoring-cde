'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('./opensky-relay-store');

// États au format OpenSky /states/all (icao24, callsign, pays, t_pos, t_contact, lon, lat, alt, au_sol, vitesse, cap, …)
const st = (hex, lat, lon) => [hex, 'TEST1 ', 'France', 0, 0, lon, lat, 10000, false, 230, 90, null, null, 10200];

test('stockage : validation, 11 champs gardés, fraîcheur 75 min', () => {
  store._reset();
  assert.throws(() => store.ingest(null), /JSON/);
  assert.throws(() => store.ingest({ fetchedAt: 'x', regions: {} }), /fetchedAt/);
  assert.throws(() => store.ingest({ fetchedAt: new Date().toISOString(), regions: {} }), /aucune donnée/);
  const now = Date.parse('2026-11-15T22:00:00Z');
  const s = store.ingest({ fetchedAt: '2026-11-15T21:50:00Z', regions: { 'eastern-europe': [st('abc123', 50, 30)], 'Mauvais Nom!': [st('x', 1, 1)] }, global: [st('abc123', 50, 30), 'pas un état'] }, now);
  assert.deepEqual(s.regions, { 'eastern-europe': 1 }); assert.equal(s.global, 1);
  assert.equal(store.getRegional(now).regions['eastern-europe'][0].length, 11);
  assert.ok(store.getGlobal(now + 60 * 60 * 1000), 'encore frais à 70 min');
  assert.equal(store.getGlobal(now + 80 * 60 * 1000), null, 'périmé après 75 min');
});

test('collecteurs : OpenSky désactivé → données du relais (zones et vue mondiale)', async () => {
  delete process.env.OPENSKY_ENABLED; store._reset();
  store.ingest({ fetchedAt: new Date().toISOString(), regions: { 'eastern-europe': [st('aaa111', 50, 30), st('bbb222', 51, 31)], 'middle-east': [st('aaa111', 50, 30)] }, global: [st('ccc333', 10, 10)] });
  const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('aucun appel réseau attendu'); };
  try {
    const air = require('./airFetcher');
    const out = await air.fetchSources();
    assert.deepEqual(out.map(a => a.hex).sort(), ['aaa111', 'bbb222'], 'dédoublonné');
    assert.equal(out[0].source, 'opensky');
    const av = require('./aviation-osint');
    await av.refreshOpenSkyCache();
    assert.equal(av.getOpenSkyCache().status, 'ok'); assert.equal(av.getOpenSkyCache().aircraft.length, 1);
  } finally { globalThis.fetch = realFetch; store._reset(); }
});

test('script relais : collecte 3 requêtes, envoie avec la clé, erreurs remontées', async () => {
  delete process.env.OPENSKY_CLIENT_ID; delete process.env.OPENSKY_CLIENT_SECRET;
  const relay = require('./opensky-relay');
  const urls = [];
  const f = async (url, opts = {}) => {
    urls.push(url);
    if (url.includes('/api/ingest/opensky')) {
      assert.equal(opts.headers['x-ingest-key'], 'cle-test');
      const body = JSON.parse(opts.body);
      assert.equal(body.regions['eastern-europe'].length, 1); assert.equal(body.global.length, 1);
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    }
    if (url.includes('lamin=20')) return { ok: false, status: 429, json: async () => ({}) };   // Moyen-Orient : quota
    return { ok: true, status: 200, json: async () => ({ states: [st('abc123', 50, 30)] }) };
  };
  const { payload, errors } = await relay.collect(f);
  assert.equal(urls.length, 3); assert.equal(errors.length, 1); assert.match(errors[0], /middle-east : OpenSky HTTP 429/);
  assert.equal(await relay.send(payload, f, 'cle-test'), '{"ok":true}');
  await assert.rejects(relay.send(payload, f, ''), /OPENSKY_INGEST_KEY absent/);
});
