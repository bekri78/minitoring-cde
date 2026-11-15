'use strict';
/**
 * opensky-relay.js — Relais OpenSky exécuté par GitHub Actions (workflow opensky-relay.yml).
 *
 * Railway ne peut pas joindre OpenSky (adresses Google Cloud bloquées) ; les exécuteurs
 * GitHub, si. Ce script récupère les mêmes données que les collecteurs du serveur
 * (zones Europe de l'Est / Moyen-Orient + vue mondiale) et les envoie au serveur.
 *
 * Variables (secrets GitHub) : OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET (OAuth2, 4 000 crédits/j),
 * OPENSKY_INGEST_KEY (clé partagée avec Railway). OGMA_SERVER_URL facultatif.
 * Coût : 12 crédits par passage (3 requêtes de grande zone à 4 crédits).
 * Les données ne sont envoyées qu'au serveur, jamais publiées (pas de redistribution).
 */

const { fetchOpenSkyJson, OPENSKY_BOXES } = require('./opensky-client');

const SERVER = (process.env.OGMA_SERVER_URL || 'https://minitoring-cde-production.up.railway.app').replace(/\/+$/, '');
const STATES = 'https://opensky-network.org/api/states/all';

async function collect(fetchImpl = globalThis.fetch) {
  const regions = {}; const errors = [];
  for (const b of OPENSKY_BOXES) {
    try {
      const j = await fetchOpenSkyJson(`${STATES}?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`, { timeoutMs: 30000, fetchImpl });
      regions[b.name] = Array.isArray(j && j.states) ? j.states.map(s => s.slice(0, 11)) : [];
    } catch (err) { errors.push(`${b.name} : ${err.message}`); }
  }
  let global = null;
  try {
    const j = await fetchOpenSkyJson(STATES, { timeoutMs: 45000, fetchImpl });
    global = Array.isArray(j && j.states) ? j.states.map(s => s.slice(0, 11)) : [];
  } catch (err) { errors.push(`global : ${err.message}`); }
  return { payload: { fetchedAt: new Date().toISOString(), regions, global }, errors };
}

async function send(payload, fetchImpl = globalThis.fetch, key = process.env.OPENSKY_INGEST_KEY) {
  if (!key) throw new Error('secret OPENSKY_INGEST_KEY absent');
  const res = await fetchImpl(`${SERVER}/api/ingest/opensky`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ingest-key': key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`serveur HTTP ${res.status} ${text.slice(0, 120)}`);
  return text;
}

async function main(fetchImpl = globalThis.fetch) {
  if (!process.env.OPENSKY_CLIENT_ID) console.warn('::warning::OPENSKY_CLIENT_ID absent : accès anonyme (400 crédits/j, insuffisant)');
  const { payload, errors } = await collect(fetchImpl);
  errors.forEach(e => console.warn('::warning::OpenSky ' + e));
  const n = Object.values(payload.regions).reduce((s, a) => s + a.length, 0);
  console.log(`OpenSky : ${n} états par zones, ${payload.global ? payload.global.length : 0} états mondiaux`);
  if (!n && !payload.global) throw new Error('aucune donnée OpenSky récupérée');
  console.log('Serveur : ' + (await send(payload, fetchImpl)));
}

if (require.main === module) {
  main().catch(err => { console.error('::error::' + err.message); process.exit(1); });
}

module.exports = { collect, send, main };
