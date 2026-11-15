'use strict';

// One-shot, read-only connectivity probe. Never displays credentials, tokens,
// URL query secrets, response bodies, or full error objects.
const dns = require('node:dns').promises;
const https = require('node:https');

async function probe(host, requestPath) {
  const started = Date.now();
  let addressInfo;
  try {
    const addresses = await dns.lookup(host, { all: true });
    addressInfo = addresses.some(x => x.family === 4) ? 'ipv4-ok' : 'no-ipv4';
  } catch (error) {
    return { dns: error.code || 'lookup-error', transport: 'not-attempted', ms: Date.now() - started };
  }

  const transport = await new Promise(resolve => {
    const request = https.get({
      hostname: host,
      port: 443,
      path: requestPath,
      method: 'GET',
      family: 4, // separately test IPv4 to avoid hiding IPv6 routing problems
      timeout: 7000,
      headers: { Accept: 'application/json', 'User-Agent': 'OGMA-OpenSky-diagnostic/1.0' },
    }, response => {
      response.resume(); // discard body without logging any content
      response.on('end', () => resolve('HTTP-' + response.statusCode));
      response.on('error', e => resolve('response-' + (e.code || 'error')));
    });
    request.on('timeout', () => {
      const e = new Error('timeout');
      e.code = 'TIMEOUT';
      request.destroy(e);
    });
    request.on('error', e => resolve(e.code || 'connection-error'));
  });
  return { dns: addressInfo, transport, ms: Date.now() - started };
}

async function runOpenSkyDiagnostics() {
  const explicitId = process.env.OPENSKY_CLIENT_ID || '';
  const explicitSecret = process.env.OPENSKY_CLIENT_SECRET || '';
  const oldId = process.env['OPENSKY_USER '] || process.env.OPENSKY_USER || '';
  const oldSecret = process.env['OPENSKY_PASS '] || process.env.OPENSKY_PASS || '';
  const id = explicitId || oldId;
  const secret = explicitSecret || oldSecret;
  const source = (explicitId || explicitSecret) ? 'oauth2-names' : (oldId || oldSecret) ? 'legacy-names' : 'absent';
  console.log('[opensky-diag] credentials source=' + source +
    ' id-present=' + Boolean(id) + ' secret-present=' + Boolean(secret) +
    ' client-id-ends-api-client=' + /-api-client$/.test(id.trim()));

  const jobs = [
    ['control', 'example.com', '/'],
    ['oauth-host', 'auth.opensky-network.org', '/auth/realms/opensky-network/.well-known/openid-configuration'],
    ['states-host', 'opensky-network.org', '/api/states/all?lamin=48.00&lomin=2.00&lamax=48.02&lomax=2.02'],
  ];
  await Promise.all(jobs.map(async ([label, host, route]) => {
    try {
      const result = await probe(host, route);
      console.log('[opensky-diag] ' + label + ' ' + JSON.stringify(result));
    } catch (error) {
      console.warn('[opensky-diag] ' + label + ' unexpected=' + (error.code || error.name));
    }
  }));
}

module.exports = { runOpenSkyDiagnostics };
