'use strict';

const fs   = require('fs');
const path = require('path');

const BASE_URL  = 'https://ll.thespacedevs.com/2.3.0';
const CACHE_DIR = process.env.CACHE_DIR || '/data';
const CACHE_FILE = path.join(CACHE_DIR, 'launches.json');
const CACHE_MAX_AGE = 4 * 60 * 60 * 1000; // 4h (même fréquence que le cron)

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

  // Retourner le cache disque si encore frais (évite le 429 au restart)
  if (cache.lastUpdate) {
    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age < CACHE_MAX_AGE) {
      console.log(`[launches] skipped — cache ${Math.round(age / 60000)}min old`);
      return;
    }
  }
  const disk = loadFromDisk();
  if (disk) {
    Object.assign(cache, disk);
    return;
  }

  isFetching = true;
  console.log('[launches] fetching from Launch Library 2...');

  try {
    // Sequential requests — respect API rate limits (no key = limited quota)
    const upcomingRes = await fetch(`${BASE_URL}/launches/upcoming/?limit=20&format=json`);
    if (!upcomingRes.ok) throw new Error(`upcoming HTTP ${upcomingRes.status}`);
    const upcoming = await upcomingRes.json();

    const previousRes = await fetch(`${BASE_URL}/launches/previous/?limit=5&format=json`);
    if (!previousRes.ok) throw new Error(`previous HTTP ${previousRes.status}`);
    const previous = await previousRes.json();

    const eventsRes = await fetch(`${BASE_URL}/events/upcoming/?limit=15&format=json`);
    if (!eventsRes.ok) throw new Error(`events HTTP ${eventsRes.status}`);
    const events = await eventsRes.json();

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
