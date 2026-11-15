'use strict';
/**
 * opensky-auth.js — Accès authentifié à l'API OpenSky (OAuth2, flux « client credentials »).
 *
 * Depuis 2025, OpenSky n'accepte plus l'authentification par identifiant / mot de passe et
 * bloque les requêtes anonymes venant des hébergeurs cloud (Railway tourne sur Google Cloud).
 * Variables Railway : OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET (compte OpenSky → API client).
 *
 *  - Jeton demandé à auth.opensky-network.org, valable 30 min, renouvelé 1 min avant expiration.
 *  - 401 sur l'API → jeton invalidé, une seule nouvelle tentative.
 *  - Erreurs explicites dans les journaux : réseau (blocage probable), authentification,
 *    quota épuisé (429), et crédits restants après chaque appel réussi.
 */

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let token = null, expiresAt = 0, pending = null;

function hasCredentials() {
  return !!(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET);
}

function netError(err, what) {
  const code = err && (err.cause && (err.cause.code || err.cause.message)) || (err && err.name === 'TimeoutError' ? 'délai dépassé' : err && err.message);
  return new Error(`${what} : connexion impossible (${code}) — blocage réseau probable`);
}

async function getToken(fetchImpl = fetch, now = Date.now()) {
  if (!hasCredentials()) return null;
  if (token && now < expiresAt - 60000) return token;
  if (pending) return pending;
  pending = (async () => {
    let res;
    try {
      res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.OPENSKY_CLIENT_ID, client_secret: process.env.OPENSKY_CLIENT_SECRET }).toString(),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) { throw netError(err, 'OpenSky jeton'); }
    if (!res.ok) throw new Error(`OpenSky jeton : HTTP ${res.status} (identifiants refusés ?)`);
    const j = await res.json();
    if (!j.access_token) throw new Error('OpenSky jeton : réponse sans access_token');
    token = j.access_token;
    expiresAt = Date.now() + (Number(j.expires_in) || 1800) * 1000;
    return token;
  })();
  try { return await pending; } finally { pending = null; }
}

function invalidate() { token = null; expiresAt = 0; }

/** GET JSON sur l'API OpenSky, authentifié si les identifiants existent. */
async function openskyJson(url, { timeoutMs = 20000, fetchImpl = fetch, label = 'OpenSky' } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await getToken(fetchImpl);
    const headers = { Accept: 'application/json', 'User-Agent': 'OGMA/1.0 (veille OSINT)' };
    if (t) headers.Authorization = 'Bearer ' + t;
    let res;
    try { res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (err) { throw netError(err, label); }
    if (res.status === 401 && t && attempt === 0) { invalidate(); continue; }
    if (res.status === 429) {
      const wait = res.headers && res.headers.get && res.headers.get('x-rate-limit-retry-after-seconds');
      throw new Error(`${label} : quota épuisé (429)${wait ? ', reprise dans ' + wait + ' s' : ''}`);
    }
    if (!res.ok) throw new Error(`${label} : HTTP ${res.status}${t ? '' : ' (sans authentification)'}`);
    const left = res.headers && res.headers.get && res.headers.get('x-rate-limit-remaining');
    const data = await res.json();
    return { data, creditsLeft: left != null ? Number(left) : null, authenticated: !!t };
  }
  throw new Error(`${label} : HTTP 401 après renouvellement du jeton`);
}

module.exports = { openskyJson, getToken, hasCredentials, _invalidate: invalidate, TOKEN_URL };
