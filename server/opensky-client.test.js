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
  delete process.env.OPENSKY_USER;
  delete process.env.OPENSKY_PASS;
  delete process.env['OPENSKY_USER '];
  delete process.env['OPENSKY_PASS '];
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

test('existing Railway names with trailing spaces provide credentials to OAuth2', async () => {
  process.env['OPENSKY_USER '] = 'existing-api-client';
  process.env['OPENSKY_PASS '] = 'existing-api-secret';
  let tokenRequests = 0;
  const fetchImpl = async (uri, opts) => {
    if (uri.includes('/token')) {
      tokenRequests++;
      assert.equal(opts.body.get('client_id'), 'existing-api-client');
      assert.equal(opts.body.get('client_secret'), 'existing-api-secret');
      return response({ access_token: 'legacy-name-token', expires_in: 1800 });
    }
    assert.equal(opts.headers.Authorization, 'Bearer legacy-name-token');
    return response({ states: [] });
  };
  await fetchOpenSkyJson(url, { fetchImpl });
  assert.equal(tokenRequests, 1);
});

test('explicit OAuth2 names override legacy names without mixing credentials', async () => {
  process.env['OPENSKY_USER '] = 'old-user';
  process.env['OPENSKY_PASS '] = 'old-pass';
  process.env.OPENSKY_CLIENT_ID = 'new-client';
  process.env.OPENSKY_CLIENT_SECRET = 'new-secret';
  let tokens = 0;
  await fetchOpenSkyJson(url, { fetchImpl: async (uri, opts) => {
    if (uri.includes('/token')) {
      tokens++;
      assert.equal(opts.body.get('client_id'), 'new-client');
      assert.equal(opts.body.get('client_secret'), 'new-secret');
      return response({ access_token: 'new-token', expires_in: 1800 });
    }
    return response({ states: [] });
  } });
  assert.equal(tokens, 1);
});
