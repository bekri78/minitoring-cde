'use strict';

/**
 * Client OpenSky partagé.
 * Depuis le 18/03/2026, l'API REST utilise OAuth2 client_credentials.
 * Les anciens identifiants OPENSKY_USER / OPENSKY_PASS ne fonctionnent plus.
 * Sans API client, OpenSky autorise encore un accès anonyme plus limité.
 */
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const TOKEN_MARGIN_MS = 60_000;
let cachedToken = null;
let expiresAt = 0;
let tokenRequest = null;

function credentials() {
  // Use current OAuth2 names when present. Otherwise read the existing Railway
  // variable names EXACTLY, including their accidental trailing spaces.
  // This preserves the secret values: no copy, rename or log output is needed.
  const configuredId = (process.env.OPENSKY_CLIENT_ID || '').trim();
  const configuredSecret = (process.env.OPENSKY_CLIENT_SECRET || '').trim();
  if (configuredId || configuredSecret) {
    if (!configuredId || !configuredSecret) {
      throw new Error('OpenSky OAuth2: configure both OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET');
    }
    return { id: configuredId, secret: configuredSecret };
  }
  const legacyId = (process.env['OPENSKY_USER '] || process.env.OPENSKY_USER || '').trim();
  const legacySecret = (process.env['OPENSKY_PASS '] || process.env.OPENSKY_PASS || '').trim();
  if (Boolean(legacyId) !== Boolean(legacySecret)) {
    throw new Error('OpenSky OAuth2: legacy Railway variables are incomplete');
  }
  // The legacy variable contents MUST be an API Client ID/Secret for OAuth2,
  // not the OpenSky website login and password.
  return legacyId ? { id: legacyId, secret: legacySecret } : null;
}

function resetTokenCache() {
  cachedToken = null;
  expiresAt = 0;
  tokenRequest = null;
}

async function accessToken(fetchImpl = globalThis.fetch) {
  const creds = credentials();
  if (!creds) return null; // anonymous mode: rate limits and hosting restrictions apply
  if (cachedToken && Date.now() + TOKEN_MARGIN_MS < expiresAt) return cachedToken;
  if (tokenRequest) return tokenRequest;

  const pending = (async () => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.id,
      client_secret: creds.secret,
    });
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      const err = new Error('OpenSky OAuth2 token HTTP ' + response.status);
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    if (!data || typeof data.access_token !== 'string' || !data.access_token) {
      throw new Error('OpenSky OAuth2: access_token absent');
    }
    cachedToken = data.access_token;
    const seconds = Number(data.expires_in);
    expiresAt = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 1800) * 1000;
    return cachedToken;
  })();
  tokenRequest = pending;
  try { return await pending; }
  finally { if (tokenRequest === pending) tokenRequest = null; }
}

async function fetchOpenSkyJson(url, { timeoutMs = 25000, fetchImpl = globalThis.fetch } = {}) {
  let token = await accessToken(fetchImpl);
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // An expired/revoked token may be rejected early. Refresh once, never loop.
    if (response.status === 401 && token && attempt === 0) {
      resetTokenCache();
      token = await accessToken(fetchImpl);
      continue;
    }
    if (!response.ok) {
      const err = new Error('OpenSky HTTP ' + response.status);
      err.status = response.status;
      throw err;
    }
    return response.json();
  }
  throw new Error('OpenSky OAuth2: token refresh failed');
}

// OpenSky bloque les adresses de Railway (Google Cloud) au niveau réseau, y compris le serveur
// de jetons : collecte désactivée par défaut. OPENSKY_ENABLED=true pour la réactiver (relais, autre hébergeur).
function isOpenSkyEnabled() {
  return /^(1|true|oui|yes|on)$/i.test(String(process.env.OPENSKY_ENABLED || '').trim());
}

// Zones interrogées (serveur et relais GitHub) : [lamin, lomin, lamax, lomax], 4 crédits chacune
const OPENSKY_BOXES = [
  { name: 'eastern-europe', lamin: 44, lomin: 20, lamax: 62, lomax: 50 },
  { name: 'middle-east',    lamin: 20, lomin: 30, lamax: 42, lomax: 65 },
];

module.exports = { fetchOpenSkyJson, resetTokenCache, isOpenSkyEnabled, OPENSKY_BOXES };
