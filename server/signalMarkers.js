'use strict';

/**
 * signalMarkers.js — Proxy cache pour world-monitor.com/api/signal-markers
 *
 * Le site bloque les requêtes navigateur (CORS), donc on fetch depuis Railway
 * côté serveur et on expose les données via notre propre API.
 * Les données sont persistées sur disque et écrasées à chaque update.
 */

const fs   = require('fs');
const path = require('path');

const SIGNAL_MARKERS_URL = 'https://world-monitor.com/api/signal-markers';
const CACHE_TTL_MS       = 30 * 60 * 1000; // 30 min
const CACHE_DIR          = process.env.CACHE_DIR || '/data';
const DISK_PATH          = path.join(CACHE_DIR, 'signal-markers.json');

let cache = { markers: [], lastUpdate: null };

function saveToDisk(markers, lastUpdate) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(DISK_PATH, JSON.stringify({ markers, lastUpdate }));
    console.log(`[signal-markers] saved ${markers.length} markers to disk`);
  } catch (err) {
    console.warn('[signal-markers] disk save failed:', err.message);
  }
}

function loadFromDisk() {
  try {
    const data = JSON.parse(fs.readFileSync(DISK_PATH, 'utf8'));
    if (data?.markers?.length) {
      console.log(`[signal-markers] restored ${data.markers.length} markers from disk`);
      return data;
    }
  } catch (_) {}
  return null;
}

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
    const lastUpdate = new Date().toISOString();

    cache = { markers, lastUpdate };
    saveToDisk(markers, lastUpdate); // écrase l'ancien fichier
    console.log(`[signal-markers] fetched ${markers.length} markers`);
  } catch (err) {
    console.warn('[signal-markers] fetch failed:', err.message);
  }
}

// Charger depuis le disque au démarrage
const _disk = loadFromDisk();
if (_disk) cache = _disk;

function getCache() { return cache; }

function isStale() {
  if (!cache.lastUpdate) return true;
  return Date.now() - new Date(cache.lastUpdate).getTime() > CACHE_TTL_MS;
}

module.exports = { fetchSignalMarkers, getCache, isStale };
