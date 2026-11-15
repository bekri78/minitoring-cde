'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('./opensky-auth');

const hdr = (o = {}) => ({ get: k => o[k.toLowerCase()] ?? null });
function fake(steps) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, opts });
    const s = steps.shift();
    if (s instanceof Error) throw s;
    return s;
  };
  f.calls = calls;
  return f;
}
const ok = (data, h = {}) => ({ ok: true, status: 200, headers: hdr(h), json: async () => data });
const tokenOk = (t = 'tok1', exp = 1800) => ({ ok: true, status: 200, json: async () => ({ access_token: t, expires_in: exp }) });

test('sans identifiants : appel anonyme, pas de jeton', async () => {
  delete process.env.OPENSKY_CLIENT_ID; delete process.env.OPENSKY_CLIENT_SECRET; os._invalidate();
  const f = fake([ok({ states: [[1]] }, { 'x-rate-limit-remaining': '390' })]);
  const r = await os.openskyJson('https://opensky-network.org/api/states/all', { fetchImpl: f });
  assert.equal(r.authenticated, false); assert.equal(r.creditsLeft, 390);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].opts.headers.Authorization, undefined);
});

test('OAuth2 : jeton demandé (client credentials), porté en Bearer, réutilisé', async () => {
  process.env.OPENSKY_CLIENT_ID = 'id-test'; process.env.OPENSKY_CLIENT_SECRET = 'secret-test'; os._invalidate();
  const f = fake([tokenOk('abc'), ok({ states: [] }), ok({ states: [] })]);
  await os.openskyJson('https://opensky-network.org/api/states/all?lamin=1', { fetchImpl: f });
  await os.openskyJson('https://opensky-network.org/api/states/all?lamin=2', { fetchImpl: f });
  assert.equal(f.calls[0].url, os.TOKEN_URL);
  assert.equal(f.calls[0].opts.method, 'POST');
  const body = new URLSearchParams(f.calls[0].opts.body);
  assert.equal(body.get('grant_type'), 'client_credentials'); assert.equal(body.get('client_id'), 'id-test'); assert.equal(body.get('client_secret'), 'secret-test');
  assert.equal(f.calls[1].opts.headers.Authorization, 'Bearer abc');
  assert.equal(f.calls.length, 3, 'un seul jeton pour deux appels');
});

test('401 : jeton renouvelé puis nouvelle tentative', async () => {
  os._invalidate();
  const f = fake([tokenOk('old'), { ok: false, status: 401, headers: hdr() }, tokenOk('new'), ok({ states: [[1], [2]] })]);
  const r = await os.openskyJson('https://opensky-network.org/api/states/all', { fetchImpl: f });
  assert.equal(r.data.states.length, 2); assert.equal(f.calls[3].opts.headers.Authorization, 'Bearer new');
});

test('erreurs explicites : quota 429, identifiants refusés, blocage réseau', async () => {
  os._invalidate();
  await assert.rejects(os.openskyJson('u', { fetchImpl: fake([tokenOk(), { ok: false, status: 429, headers: hdr({ 'x-rate-limit-retry-after-seconds': '3600' }) }]) }), /quota épuisé \(429\), reprise dans 3600 s/);
  os._invalidate();
  await assert.rejects(os.openskyJson('u', { fetchImpl: fake([{ ok: false, status: 401 }]) }), /jeton : HTTP 401 \(identifiants refusés/);
  os._invalidate();
  const e = new TypeError('fetch failed'); e.cause = { code: 'ETIMEDOUT' };
  await assert.rejects(os.openskyJson('u', { fetchImpl: fake([tokenOk(), e]), label: 'OpenSky test' }), /OpenSky test : connexion impossible \(ETIMEDOUT\) — blocage réseau probable/);
  delete process.env.OPENSKY_CLIENT_ID; delete process.env.OPENSKY_CLIENT_SECRET; os._invalidate();
});
