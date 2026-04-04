'use strict';

const fs   = require('fs');
const path = require('path');

const FEED_URL      = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';
const CACHE_DIR     = process.env.CACHE_DIR || '/data';
const CACHE_FILE    = path.join(CACHE_DIR, 'earthquakes.json');
const CACHE_MAX_AGE = 15 * 60 * 1000; // 15min

let cache = {
  quakes:     [],
  lastUpdate: null,
};

let isFetching = false;

// ── Couleur selon magnitude / alerte PAGER ────────────────────────────────────
function colorByMag(mag, alert) {
  if (alert === 'red')    return '#ff2244';
  if (alert === 'orange') return '#ff6600';
  if (alert === 'yellow') return '#ffaa00';
  if (mag >= 7.0) return '#ff2244';
  if (mag >= 6.0) return '#ff6600';
  if (mag >= 5.0) return '#ffaa00';
  return '#ffdd55';
}

function normalize(f) {
  const p   = f.properties || {};
  const geo = f.geometry?.coordinates || [0, 0, 0];
  const mag = Number(p.mag) || 0;
  return {
    id:      f.id || `${geo[1]}_${geo[0]}_${p.time}`,
    mag,
    place:   p.place  || '',
    time:    p.time   ? new Date(p.time).toISOString() : null,
    depth:   Number(geo[2]) || 0,
    lat:     Number(geo[1]) || 0,
    lon:     Number(geo[0]) || 0,
    tsunami: Boolean(p.tsunami),
    alert:   p.alert  || null,
    url:     p.url    || '',
    sig:     Number(p.sig) || 0,
    color:   colorByMag(mag, p.alert),
  };
}

// ── Persistance disque ────────────────────────────────────────────────────────
function saveToDisk() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    console.log(`[earthquakes] saved — ${cache.quakes.length} séismes`);
  } catch (err) {
    console.warn('[earthquakes] save failed:', err.message);
  }
}

function loadFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw?.lastUpdate) {
      const age = Date.now() - new Date(raw.lastUpdate).getTime();
      if (age < CACHE_MAX_AGE) {
        console.log(`[earthquakes] restored from disk — ${raw.quakes?.length ?? 0} séismes (${Math.round(age / 60000)}min old)`);
        return raw;
      }
    }
  } catch (_) {}
  return null;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchQuakes() {
  if (isFetching) {
    console.log('[earthquakes] already fetching — skipped');
    return;
  }

  if (cache.lastUpdate) {
    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age < CACHE_MAX_AGE) {
      console.log(`[earthquakes] skipped — cache ${Math.round(age / 60000)}min old`);
      return;
    }
  }

  const disk = loadFromDisk();
  if (disk) {
    Object.assign(cache, disk);
    return;
  }

  isFetching = true;
  console.log('[earthquakes] fetching from USGS...');

  try {
    const resp = await fetch(FEED_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    cache.quakes     = (data.features || []).map(normalize);
    cache.lastUpdate = new Date().toISOString();
    saveToDisk();
    console.log(`[earthquakes] ok — ${cache.quakes.length} séismes M4.5+`);
  } catch (err) {
    console.error('[earthquakes] fetch failed:', err.message);
  } finally {
    isFetching = false;
  }
}

function getCache() { return cache; }

module.exports = { fetchQuakes, getCache };
