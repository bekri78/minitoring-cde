'use strict';

/**
 * signalMarkers.js — Proxy cache pour world-monitor.com/api/signal-markers
 *
 * Le site bloque les requêtes navigateur (CORS), donc on fetch depuis Railway
 * côté serveur et on expose les données via notre propre API.
 */

const SIGNAL_MARKERS_URL = 'https://world-monitor.com/api/signal-markers';
const CACHE_TTL_MS       = 5 * 60 * 1000; // 5 min

let cache = { markers: [], lastUpdate: null };

async function fetchSignalMarkers() {
  try {
    const resp = await fetch(SIGNAL_MARKERS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; world-monitor-proxy/1.0)',
        'Accept':     'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const markers = Array.isArray(data) ? data : (data?.locations || data?.markers || data?.data || []);

    cache = { markers, lastUpdate: new Date().toISOString() };
    console.log(`[signal-markers] fetched ${markers.length} markers`);
  } catch (err) {
    console.warn('[signal-markers] fetch failed:', err.message);
  }
}

function getCache() { return cache; }

function isStale() {
  if (!cache.lastUpdate) return true;
  return Date.now() - new Date(cache.lastUpdate).getTime() > CACHE_TTL_MS;
}

module.exports = { fetchSignalMarkers, getCache, isStale };
