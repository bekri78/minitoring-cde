'use strict';

/**
 * worldEvents.js — Proxy cache pour world-monitor.com/api/events
 *
 * Fetch côté serveur (CORS bloqué navigateur), persistance disque,
 * écrasement à chaque update.
 */

const fs   = require('fs');
const path = require('path');

const WORLD_EVENTS_URL = 'https://world-monitor.com/api/events';
const CACHE_TTL_MS     = 30 * 60 * 1000; // 30 min
const CACHE_DIR        = process.env.CACHE_DIR || '/data';
const DISK_PATH        = path.join(CACHE_DIR, 'world-events.json');

let cache = { events: [], lastUpdate: null };

function saveToDisk(events, lastUpdate) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(DISK_PATH, JSON.stringify({ events, lastUpdate }));
    console.log(`[world-events] saved ${events.length} events to disk`);
  } catch (err) {
    console.warn('[world-events] disk save failed:', err.message);
  }
}

function loadFromDisk() {
  try {
    const data = JSON.parse(fs.readFileSync(DISK_PATH, 'utf8'));
    if (data?.events?.length) {
      console.log(`[world-events] restored ${data.events.length} events from disk`);
      return data;
    }
  } catch (_) {}
  return null;
}

async function fetchWorldEvents() {
  try {
    const resp = await fetch(WORLD_EVENTS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; world-monitor-proxy/1.0)',
        'Accept':     'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data    = await resp.json();
    const events  = Array.isArray(data) ? data : (data?.markers || data?.events || data?.data || []);
    const lastUpdate = new Date().toISOString();

    cache = { events, lastUpdate };
    saveToDisk(events, lastUpdate);
    console.log(`[world-events] fetched ${events.length} events`);
  } catch (err) {
    console.warn('[world-events] fetch failed:', err.message);
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

module.exports = { fetchWorldEvents, getCache, isStale };
