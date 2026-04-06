'use strict';

/**
 * airFetcher.js — Sources ADS-B supplémentaires pour WORLD MONITOR
 *
 * Schéma interne de sortie (toutes sources) :
 * {
 *   hex, flight, lat, lon, alt_baro, gs, track, t, source
 * }
 *
 * Contraintes :
 *   - max 2 requêtes simultanées (via fetchPool)
 *   - timeout 5 s par requête
 *   - retry max 2 fois
 *   - cache mémoire 60 s par source
 */

// ── Config ─────────────────────────────────────────────────────────────────
const TIMEOUT_MS     = 5_000;
const RETRY_MAX      = 2;
const CACHE_TTL_MS   = 60_000;
const CONCURRENCY    = 2;       // max requêtes simultanées

// Zones OpenSky à sonder (bounding boxes [lamin, lomin, lamax, lomax])
// Limité à 2 zones pour rester sous le rate-limit anonyme (10 req/min)
// Priorité aux zones de conflit actif non couvertes par /mil endpoints
const OPENSKY_BOXES = [
  { name: 'eastern-europe', lamin: 44, lomin: 20, lamax: 62, lomax: 50 },
  { name: 'middle-east',    lamin: 20, lomin: 30, lamax: 42, lomax: 65 },
];

// ── Cache mémoire par source ───────────────────────────────────────────────
const sourceCache = new Map();
// sourceCache: name → { data: [...], ts: number }

function getCached(name) {
  const entry = sourceCache.get(name);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  return null;
}
function setCache(name, data) {
  sourceCache.set(name, { data, ts: Date.now() });
}

// ── Fetch avec timeout + retry ─────────────────────────────────────────────
async function fetchWithRetry(url, options = {}, attempt = 0) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (res.status === 429) throw new Error('429 rate-limited');
    if (!res.ok)           throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt < RETRY_MAX) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Pool de concurrence (max N requêtes simultanées) ──────────────────────
function makePool(concurrency) {
  let running = 0;
  const queue = [];
  function next() {
    while (running < concurrency && queue.length) {
      running++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(resolve, reject).finally(() => { running--; next(); });
    }
  }
  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}
const fetchPool = makePool(CONCURRENCY);

// ── Normalisation commune ──────────────────────────────────────────────────
function clean(v) { return v != null && v !== '' ? v : null; }

function toNum(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// ══════════════════════════════════════════════════════════════════════════
// SOURCE — OpenSky Network  /api/states/all
// airplanes.live et adsb.fi sont gérés par military-aircraft.js (MIL_SOURCES)
// ══════════════════════════════════════════════════════════════════════════

// Mapping du tableau OpenSky :
//  [0]  icao24   [1]  callsign  [2]  origin_country
//  [5]  longitude [6] latitude  [7]  baro_alt (m)
//  [9]  velocity (m/s)  [10] heading  [8] on_ground
function normalizeOpenSkyState(s) {
  if (!s || s[8]) return null;                      // on_ground
  const lat = toNum(s[6]), lon = toNum(s[5]);
  if (lat == null || lon == null) return null;

  const altM  = toNum(s[7]);
  const altFt = altM != null ? Math.round(altM * 3.281) : null;
  const gs    = toNum(s[9]);

  return {
    hex:      clean((s[0] || '').toLowerCase()),
    flight:   clean((s[1] || '').trim()),
    lat,
    lon,
    alt_baro: altFt,
    gs:       gs != null ? Math.round(gs * 1.944) : null,  // m/s → kts
    track:    toNum(s[10]),
    t:        null,       // OpenSky states/all ne retourne pas le type
    source:   'opensky',
  };
}

async function fetchOpenSkyBox(box) {
  const { lamin, lomin, lamax, lomax } = box;
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  const data = await fetchPool(() =>
    fetchWithRetry(url, { headers: { 'User-Agent': 'WorldMonitor/1.0' } })
  );
  return (data?.states || []).map(normalizeOpenSkyState).filter(Boolean);
}

async function fetchOpenSky() {
  const cached = getCached('opensky');
  if (cached) return cached;

  // Lancer toutes les bounding boxes en parallèle (elles passent quand même par le pool)
  const results = await Promise.allSettled(OPENSKY_BOXES.map(fetchOpenSkyBox));

  const seen = new Map();
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const ac of r.value) {
        if (ac.hex && !seen.has(ac.hex)) seen.set(ac.hex, ac);
      }
    }
  }

  const out = Array.from(seen.values());
  console.log(`[mil-aircraft] opensky raw=${out.length} accepted=${out.length}`);
  setCache('opensky', out);
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// FETCH SOURCES — point d'entrée unique
// ══════════════════════════════════════════════════════════════════════════

/**
 * Lance toutes les sources en parallèle (dans la limite du pool).
 * Retourne un tableau plat de tracks au schéma interne.
 * Les erreurs individuelles sont absorbées (warn) — les autres sources continuent.
 */
async function fetchSources() {
  // airplanes.live et adsb.fi sont déjà gérés par le pipeline legacy (fetchMilSource)
  // avec filtre militaire strict — les redoubler ici causerait des 429.
  // airFetcher apporte uniquement les sources complémentaires.
  const fetchers = [
    { name: 'opensky', fn: fetchOpenSky },
  ];

  const results = await Promise.allSettled(fetchers.map(f => f.fn()));

  const all = [];
  for (let i = 0; i < fetchers.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      all.push(...r.value);
    } else {
      console.warn(`[mil-aircraft] ${fetchers[i].name} failed: ${r.reason?.message}`);
    }
  }
  return all;
}

/**
 * Fusionne les tracks par hex (déduplication).
 * Priorité : airplanes.live > adsb.fi > opensky > airframes
 * (premier arrivé conservé — l'ordre de fetchSources garantit la priorité)
 *
 * Les tracks sans hex (airframes ACARS) sont gardés tels quels avec un id
 * synthétique pour ne pas les perdre.
 */
function mergeTracksByHex(tracks) {
  const seen   = new Map();
  const noHex  = [];
  let synthetic = 0;

  for (const t of tracks) {
    if (!t.hex) {
      // Airframes sans ICAO : id synthétique basé sur callsign + position
      const key = `acars_${t.flight || ''}_${synthetic++}`;
      noHex.push({ ...t, hex: key });
    } else if (!seen.has(t.hex)) {
      seen.set(t.hex, t);
    }
  }

  const merged = [...seen.values(), ...noHex];
  console.log(`[mil-aircraft] merged unique=${merged.length}`);
  return merged;
}

module.exports = {
  fetchSources,
  mergeTracksByHex,
  fetchOpenSky, // export pour tests
};
