'use strict';

const fs   = require('fs');
const path = require('path');

const BASE_URL  = 'https://ll.thespacedevs.com/2.3.0';
const CACHE_DIR = process.env.CACHE_DIR || '/data';
const CACHE_FILE = path.join(CACHE_DIR, 'launches.json');
const CACHE_MAX_AGE = 6 * 60 * 60 * 1000; // 6h

// Retry-after : timestamp epoch en ms avant lequel on ne retente pas l'API
let retryAfterUntil = 0;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Status ID → display color (Launch Library 2 status IDs)
const STATUS_COLOR = {
  1: '#00ff88',  // Go for Launch
  2: '#ffaa00',  // To Be Determined
  3: '#00d4ff',  // Launch Successful
  4: '#ff2244',  // Launch Failure
  5: '#ffdd55',  // On Hold
  6: '#ff6600',  // Partial Failure
  7: '#ffaa00',  // To Be Confirmed
};

let cache = {
  launches:   [],
  previous:   [],
  events:     [],
  pads:       [],
  lastUpdate: null,
};

let isFetching = false;

function saveToDisk() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    console.log(`[launches] saved to disk — ${cache.launches.length} upcoming, ${cache.pads.length} pads`);
  } catch (err) {
    console.warn('[launches] save failed:', err.message);
  }
}

function loadFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw?.lastUpdate) {
      const age = Date.now() - new Date(raw.lastUpdate).getTime();
      if (age < CACHE_MAX_AGE) {
        console.log(`[launches] restored from disk — ${raw.launches?.length ?? 0} upcoming, ${raw.pads?.length ?? 0} pads (${Math.round(age / 60000)}min old)`);
        return raw;
      }
    }
  } catch (_) {}
  return null;
}

function normalizeLaunch(l) {
  return {
    id:           l.id,
    name:         l.name || 'Unknown Mission',
    net:          l.net          || null,
    window_start: l.window_start || null,
    window_end:   l.window_end   || null,
    status: {
      id:    l.status?.id   || 0,
      label: l.status?.abbrev || '?',
      color: STATUS_COLOR[l.status?.id] || '#4a6a7a',
      desc:  l.status?.name  || '',
    },
    provider:     l.launch_service_provider?.name            || 'Unknown',
    providerType: l.launch_service_provider?.type?.name      || '',
    rocket:       l.rocket?.configuration?.full_name
               || l.rocket?.configuration?.name
               || 'Unknown',
    mission: {
      name:  l.mission?.name              || '',
      type:  l.mission?.type              || '',
      orbit: l.mission?.orbit?.name       || '',
      desc:  l.mission?.description       || '',
    },
    pad: {
      name:    l.pad?.name               || '',
      lat:     parseFloat(l.pad?.latitude)  || 0,
      lon:     parseFloat(l.pad?.longitude) || 0,
      country: l.pad?.country?.name      || '',
    },
    image:       l.image?.thumbnail_url || l.image?.image_url || null,
    webcastLive: Boolean(l.webcast_live),
    failreason:  l.failreason || '',
  };
}

function normalizeEvent(e) {
  return {
    id:          e.id,
    name:        e.name        || 'Unknown Event',
    date:        e.date        || null,
    type:        e.type?.name  || '',
    location:    e.location    || '',
    description: e.description || '',
    image:       e.image?.thumbnail_url || e.image?.image_url || null,
    webcastLive: Boolean(e.webcast_live),
  };
}

async function fetchAll() {
  if (isFetching) {
    console.log('[launches] already fetching — skipped');
    return;
  }

  // Toujours essayer de charger depuis le disque d'abord (évite 429 au restart)
  const disk = loadFromDisk();
  if (disk) {
    Object.assign(cache, disk);
    return;
  }

  // Retourner le cache mémoire si encore frais
  if (cache.lastUpdate) {
    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age < CACHE_MAX_AGE) {
      console.log(`[launches] skipped — cache ${Math.round(age / 60000)}min old`);
      return;
    }
  }

  // Respecter le Retry-After reçu lors d'un 429 précédent
  if (retryAfterUntil > Date.now()) {
    const wait = Math.round((retryAfterUntil - Date.now()) / 60000);
    console.log(`[launches] skipped — rate-limited, retry in ${wait}min`);
    return;
  }

  isFetching = true;
  console.log('[launches] fetching from Launch Library 2...');

  // Helper qui gère le 429 et lit Retry-After
  async function safeFetch(url, label) {
    const res = await fetch(url);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '3600', 10);
      retryAfterUntil = Date.now() + retryAfter * 1000;
      throw new Error(`${label} HTTP 429 — retry in ${Math.round(retryAfter / 60)}min`);
    }
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    return res.json();
  }

  try {
    // Requêtes séquentielles avec délai 2s pour ne pas saturer le quota free tier
    const upcoming = await safeFetch(`${BASE_URL}/launches/upcoming/?limit=20&format=json`, 'upcoming');
    await sleep(2000);
    const previous = await safeFetch(`${BASE_URL}/launches/previous/?limit=5&format=json`, 'previous');
    await sleep(2000);
    const events   = await safeFetch(`${BASE_URL}/events/upcoming/?limit=15&format=json`, 'events');

    cache.launches = (upcoming.results || []).map(normalizeLaunch);
    cache.previous = (previous.results || []).map(normalizeLaunch);
    cache.events   = (events.results   || []).map(normalizeEvent);

    // Build unique pad list from fetched launches for map display
    const padMap = {};
    cache.launches.forEach(l => {
      if (!l.pad.lat || !l.pad.lon) return;
      const key = `${l.pad.lat.toFixed(3)},${l.pad.lon.toFixed(3)}`;
      padMap[key] = { ...l.pad, hasUpcoming: true };
    });
    cache.previous.forEach(l => {
      if (!l.pad.lat || !l.pad.lon) return;
      const key = `${l.pad.lat.toFixed(3)},${l.pad.lon.toFixed(3)}`;
      if (!padMap[key]) padMap[key] = { ...l.pad, hasUpcoming: false };
    });
    cache.pads = Object.values(padMap);

    cache.lastUpdate = new Date().toISOString();
    saveToDisk();
    console.log(
      `[launches] ok — ${cache.launches.length} upcoming, ` +
      `${cache.previous.length} previous, ${cache.events.length} events, ` +
      `${cache.pads.length} pads`
    );
  } catch (err) {
    console.error('[launches] fetch failed:', err.message);
  } finally {
    isFetching = false;
  }
}

function getCache() {
  return cache;
}

module.exports = { fetchAll, getCache };
