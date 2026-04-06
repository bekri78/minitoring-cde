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
// Couvrent Europe de l'Est, Baltique, Moyen-Orient, Mer de Chine, Arctique
const OPENSKY_BOXES = [
  { name: 'europe-east', lamin: 44, lomin: 20, lamax: 60, lomax: 45 },
  { name: 'baltic',      lamin: 53, lomin: 15, lamax: 65, lomax: 30 },
  { name: 'middle-east', lamin: 20, lomin: 30, lamax: 42, lomax: 65 },
  { name: 'china-sea',   lamin: 10, lomin: 105, lamax: 45, lomax: 135 },
  { name: 'arctic',      lamin: 65, lomin: -20, lamax: 85, lomax: 60 },
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
// SOURCE 1 — airplanes.live  /v2/mil
// ══════════════════════════════════════════════════════════════════════════
async function fetchAirplanesLive() {
  const cached = getCached('airplanes.live');
  if (cached) return cached;

  const SOURCE = 'airplanes.live';
  const url    = 'https://api.airplanes.live/v2/mil';

  const data = await fetchPool(() =>
    fetchWithRetry(url, { headers: { 'User-Agent': 'WorldMonitor/1.0' } })
  );

  const raw = data?.ac || [];
  const out = raw
    .filter(a => a.lat != null && a.lon != null && a.alt_baro !== 'ground' && !a.on_ground)
    .map(a => ({
      hex:      clean((a.hex || '').toLowerCase().replace(/^~/, '')),
      flight:   clean(a.flight || a.r),
      lat:      toNum(a.lat),
      lon:      toNum(a.lon),
      alt_baro: a.alt_baro != null && a.alt_baro !== 'ground' ? Math.round(toNum(a.alt_baro)) : null,
      gs:       a.gs   != null ? Math.round(toNum(a.gs))   : null,
      track:    a.track != null ? toNum(a.track)            : null,
      t:        clean(a.t || a.type),
      source:   SOURCE,
    }))
    .filter(a => a.hex);

  console.log(`[mil-aircraft] ${SOURCE} raw=${raw.length} accepted=${out.length}`);
  setCache(SOURCE, out);
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// SOURCE 2 — adsb.fi  /api/v2/mil
// ══════════════════════════════════════════════════════════════════════════
async function fetchAdsbFi() {
  const cached = getCached('adsb.fi');
  if (cached) return cached;

  const SOURCE = 'adsb.fi';
  const url    = 'https://opendata.adsb.fi/api/v2/mil';

  const data = await fetchPool(() =>
    fetchWithRetry(url, { headers: { 'User-Agent': 'WorldMonitor/1.0' } })
  );

  const raw = data?.ac || [];
  const out = raw
    .filter(a => a.lat != null && a.lon != null && a.alt_baro !== 'ground' && !a.on_ground)
    .map(a => ({
      hex:      clean((a.hex || '').toLowerCase().replace(/^~/, '')),
      flight:   clean(a.flight || a.r),
      lat:      toNum(a.lat),
      lon:      toNum(a.lon),
      alt_baro: a.alt_baro != null && a.alt_baro !== 'ground' ? Math.round(toNum(a.alt_baro)) : null,
      gs:       a.gs    != null ? Math.round(toNum(a.gs))  : null,
      track:    a.track != null ? toNum(a.track)           : null,
      t:        clean(a.t || a.type),
      source:   SOURCE,
    }))
    .filter(a => a.hex);

  console.log(`[mil-aircraft] ${SOURCE} raw=${raw.length} accepted=${out.length}`);
  setCache(SOURCE, out);
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// SOURCE 3 — OpenSky Network  /api/states/all
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
// SOURCE 4 — Airframes.io  (ACARS / HFDL)
// ══════════════════════════════════════════════════════════════════════════
function normalizeAirframesMessage(msg) {
  // Garder uniquement les messages avec coordonnées
  const lat = toNum(msg.lat  ?? msg.position?.lat);
  const lon = toNum(msg.lon  ?? msg.position?.lon ?? msg.position?.lng);
  if (lat == null || lon == null) return null;

  return {
    hex:      null,                                // ACARS ne fournit pas toujours l'ICAO
    flight:   clean(msg.callsign || msg.flight || msg.tail),
    lat,
    lon,
    alt_baro: msg.altitude != null ? Math.round(toNum(msg.altitude)) : null,
    gs:       null,
    track:    null,
    t:        clean(msg.aircraft_type || msg.type),
    source:   'airframes',
  };
}

async function fetchAirframes() {
  const cached = getCached('airframes');
  if (cached) return cached;

  const SOURCE = 'airframes';
  const url    = 'https://api.airframes.io/v1/messages';

  const data = await fetchPool(() =>
    fetchWithRetry(url, {
      headers: {
        'User-Agent': 'WorldMonitor/1.0',
        'Accept':     'application/json',
      },
    })
  );

  const raw = Array.isArray(data) ? data : (data?.messages || []);
  const out = raw.map(normalizeAirframesMessage).filter(Boolean);

  console.log(`[mil-aircraft] ${SOURCE} raw=${raw.length} accepted=${out.length}`);
  setCache(SOURCE, out);
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
  const fetchers = [
    { name: 'airplanes.live', fn: fetchAirplanesLive },
    { name: 'adsb.fi',        fn: fetchAdsbFi        },
    { name: 'opensky',        fn: fetchOpenSky        },
    { name: 'airframes',      fn: fetchAirframes      },
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
  // Exports individuels utiles pour les tests
  fetchAirplanesLive,
  fetchAdsbFi,
  fetchOpenSky,
  fetchAirframes,
};
