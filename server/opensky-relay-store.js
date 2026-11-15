'use strict';
/**
 * opensky-relay-store.js — Données OpenSky reçues du relais GitHub Actions.
 *
 * OpenSky bloque les adresses de Railway (Google Cloud) ; les exécuteurs GitHub Actions
 * y accèdent. Le workflow « opensky-relay » interroge OpenSky toutes les 30 min et envoie
 * le résultat à POST /api/ingest/opensky (clé partagée OPENSKY_INGEST_KEY). Ce module
 * garde le dernier envoi et le sert aux collecteurs (airFetcher, aviation-osint).
 *
 * Format reçu : { fetchedAt, regions: { nom: [états] }, global: [états] }
 * Un état = tableau OpenSky /states/all (on garde les 11 premiers champs).
 */

const MAX_AGE_MS  = 75 * 60 * 1000;   // relais toutes les 30 min, retards GitHub possibles
const MAX_STATES  = 25000;
const MAX_REGIONS = 10;

let store = { fetchedAt: null, receivedAt: null, regions: null, global: null };

function compact(states) {
  if (!Array.isArray(states)) return [];
  const out = [];
  for (const s of states) {
    if (out.length >= MAX_STATES) break;
    if (Array.isArray(s) && typeof s[0] === 'string') out.push(s.slice(0, 11));
  }
  return out;
}

/** Valide et enregistre un envoi du relais ; renvoie un résumé ou lève une erreur. */
function ingest(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object') throw new Error('corps JSON attendu');
  const fetchedAt = Date.parse(payload.fetchedAt);
  if (!Number.isFinite(fetchedAt)) throw new Error('fetchedAt invalide');
  if (fetchedAt > now + 5 * 60 * 1000) throw new Error('fetchedAt dans le futur');
  const regions = {};
  const names = Object.keys(payload.regions || {}).slice(0, MAX_REGIONS);
  for (const n of names) {
    if (!/^[a-z0-9-]{1,40}$/.test(n)) continue;
    regions[n] = compact(payload.regions[n]);
  }
  const global = payload.global == null ? null : compact(payload.global);
  if (!Object.keys(regions).length && !global) throw new Error('aucune donnée');
  store = { fetchedAt: new Date(fetchedAt).toISOString(), receivedAt: new Date(now).toISOString(), regions, global };
  return { fetchedAt: store.fetchedAt, regions: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, v.length])), global: global ? global.length : null };
}

function fresh(now = Date.now()) {
  return !!store.fetchedAt && now - Date.parse(store.fetchedAt) <= MAX_AGE_MS;
}

/** États par zone si le dernier envoi est récent, sinon null. */
function getRegional(now = Date.now()) {
  return fresh(now) && store.regions && Object.keys(store.regions).length ? { fetchedAt: store.fetchedAt, regions: store.regions } : null;
}

/** États mondiaux si le dernier envoi est récent, sinon null. */
function getGlobal(now = Date.now()) {
  return fresh(now) && store.global ? { fetchedAt: store.fetchedAt, states: store.global } : null;
}

function status(now = Date.now()) {
  return { fetchedAt: store.fetchedAt, receivedAt: store.receivedAt, fresh: fresh(now) };
}

module.exports = { ingest, getRegional, getGlobal, status, MAX_AGE_MS, _reset: () => { store = { fetchedAt: null, receivedAt: null, regions: null, global: null }; } };
