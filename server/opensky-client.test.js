'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { fetchOpenSkyJson, resetTokenCache } = require('./opensky-client');

const url = 'https://opensky-network.org/api/states/all';
function response(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj };
}
afterEach(() => {
  delete process.env.OPENSKY_CLIENT_ID;
  delete process.env.OPENSKY_CLIENT_SECRET;
  resetTokenCache();
});

test('anonymous mode never sends legacy Basic authorization', async () => {
  const calls = [];
  const data = await fetchOpenSkyJson(url, { fetchImpl: async (uri, opts) => {
    calls.push({ uri, opts });
    return response({ states: [] });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.headers.Authorization, undefined);
  assert.deepEqual(data.states, []);
});

test('OAuth2 client credentials token is reused across requests', async () => {
  process.env.OPENSKY_CLIENT_ID = 'demo';
  process.env.OPENSKY_CLIENT_SECRET = 'secret';
  let tokens = 0;
  const fetchImpl = async (uri, opts) => {
    if (uri.includes('/token')) {
      tokens++;
      assert.equal(opts.method, 'POST');
      assert.equal(opts.body.get('grant_type'), 'client_credentials');
      return response({ access_token: 'token-1', expires_in: 1800 });
    }
    assert.equal(opts.headers.Authorization, 'Bearer token-1');
    return response({ states: [] });
  };
  await fetchOpenSkyJson(url, { fetchImpl });
  await fetchOpenSkyJson(url, { fetchImpl });
  assert.equal(tokens, 1);
});

test('401 triggers exactly one token refresh', async () => {
  process.env.OPENSKY_CLIENT_ID = 'demo';
  process.env.OPENSKY_CLIENT_SECRET = 'secret';
  let tokens = 0;
  let requests = 0;
  const fetchImpl = async (uri, opts) => {
    if (uri.includes('/token')) return response({ access_token: 'token-' + ++tokens, expires_in: 1800 });
    requests++;
    return requests === 1 ? response({}, 401) : response({ states: [] });
  };
  await fetchOpenSkyJson(url, { fetchImpl });
  assert.equal(tokens, 2);
  assert.equal(requests, 2);
});

test('partial credentials fail explicitly', async () => {
  process.env.OPENSKY_CLIENT_ID = 'missing-secret';
  await assert.rejects(fetchOpenSkyJson(url, { fetchImpl: async () => response({ states: [] }) }), /configure both/);
});

test('403 is reported without retrying or overwriting data', async () => {
  let calls = 0;
  await assert.rejects(fetchOpenSkyJson(url, { fetchImpl: async () => {
    calls++;
    return response({}, 403);
  } }), /OpenSky HTTP 403/);
  assert.equal(calls, 1);
});
