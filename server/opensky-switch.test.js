'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('OpenSky désactivé par défaut : aucun appel réseau, recoupement « non observable »', async () => {
  delete process.env.OPENSKY_ENABLED;
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('ne doit pas être appelé'); };
  try {
    const { isOpenSkyEnabled } = require('./opensky-client');
    assert.equal(isOpenSkyEnabled(), false);
    const air = require('./airFetcher');
    assert.deepEqual(await air.fetchSources(), []);
    const av = require('./aviation-osint');
    await av.refreshOpenSkyCache();
    assert.equal(calls, 0, 'aucune requête vers OpenSky');
  } finally { globalThis.fetch = realFetch; }
});

test('OPENSKY_ENABLED=true réactive la collecte', () => {
  const { isOpenSkyEnabled } = require('./opensky-client');
  for (const v of ['true', '1', 'oui', 'TRUE']) { process.env.OPENSKY_ENABLED = v; assert.equal(isOpenSkyEnabled(), true, v); }
  process.env.OPENSKY_ENABLED = 'false'; assert.equal(isOpenSkyEnabled(), false);
  delete process.env.OPENSKY_ENABLED;
});
