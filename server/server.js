'use strict';

const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const fs      = require('fs');
const path    = require('path');
const { fetchTodayEvents }      = require('./gdelt');
const { enrichEvents }          = require('./enrich');
const { fetchAll: fetchLaunches, getCache: getLaunchCache } = require('./launches');

const app      = express();
const PORT     = process.env.PORT || 3000;
const CACHE_DIR = process.env.CACHE_DIR || '/data';

app.use(cors());
app.use(express.json());

// ── État en mémoire ───────────────────────────────────────────────────────
let cache = {
  events:     [],
  lastUpdate: null,
  date:       null,
  status:     'initializing'
};
let isRefreshing = false;

// ── Persistance disque ────────────────────────────────────────────────────
function diskCachePath(date) {
  return path.join(CACHE_DIR, `events-${date}.json`);
}

function saveToDisk(date, events, lastUpdate) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(diskCachePath(date), JSON.stringify({ events, lastUpdate }));
    console.log(`[disk] saved ${events.length} events for ${date}`);
  } catch (err) {
    console.warn('[disk] save failed:', err.message);
  }
}

function loadFromDisk(date) {
  try {
    const data = JSON.parse(fs.readFileSync(diskCachePath(date), 'utf8'));
    if (data?.events?.length) {
      console.log(`[disk] loaded ${data.events.length} events for ${date}`);
      return data;
    }
  } catch (_) {}
  return null;
}

// ── Refresh GDELT ─────────────────────────────────────────────────────────
async function refresh(force = false) {
  if (isRefreshing) {
    console.log('[refresh] skipped — already in progress');
    return;
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Si déjà enrichi aujourd'hui → skip jusqu'au lendemain
  if (!force && cache.date === today && cache.status === 'ok') {
    console.log('[refresh] skipped — already enriched today');
    return;
  }

  isRefreshing = true;

  // Charger depuis le disque si disponible (évite l'enrichissement IA au restart)
  if (!force) {
    const disk = loadFromDisk(today);
    if (disk) {
      cache.events     = disk.events;
      cache.lastUpdate = disk.lastUpdate;
      cache.date       = today;
      cache.status     = 'ok';
      isRefreshing     = false;
      console.log(`[refresh] restored from disk — ${disk.events.length} events`);
      return;
    }
  }

  console.log('[refresh] starting...');
  cache.status = 'refreshing';

  try {
    const raw       = await fetchTodayEvents();
    const MAX_ENRICH = 200;
    // Sort by most negative Goldstein (highest conflict intensity) — enrich only these
    const toEnrich   = [...raw].sort((a, b) => (a.goldstein || 0) - (b.goldstein || 0)).slice(0, MAX_ENRICH);
    console.log(`[refresh] ${raw.length} raw events — enriching top ${toEnrich.length} with AI (rest discarded)...`);
    const events     = await enrichEvents(toEnrich);
    cache.events     = events;
    cache.lastUpdate = new Date().toISOString();
    cache.date       = today;
    cache.status     = 'ok';
    saveToDisk(today, events, cache.lastUpdate);
    console.log(`[refresh] done — ${events.length} events after AI enrichment`);
  } catch (err) {
    cache.status = 'error';
    console.error('[refresh] failed:', err.message);
  } finally {
    isRefreshing = false;
  }
}

// ── Endpoints ─────────────────────────────────────────────────────────────
app.get('/events', (req, res) => {
  res.json({
    events:     cache.events,
    count:      cache.events.length,
    lastUpdate: cache.lastUpdate,
    date:       cache.date,
    status:     cache.status
  });
});

app.get('/launches', (req, res) => {
  const c = getLaunchCache();
  res.json({
    launches:   c.launches,
    previous:   c.previous,
    events:     c.events,
    pads:       c.pads,
    lastUpdate: c.lastUpdate,
    status:     c.lastUpdate ? 'ok' : 'initializing',
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok:         cache.status === 'ok',
    status:     cache.status,
    events:     cache.events.length,
    lastUpdate: cache.lastUpdate,
    date:       cache.date
  });
});

// ── Endpoint refresh manuel (force=true ignore le cache disque) ───────────
app.post('/refresh', (req, res) => {
  res.json({ ok: true, message: 'refresh triggered' });
  refresh(true).catch(err => console.error('[manual-refresh] failed:', err.message));
});

// ── Cron 15 min — GDELT ───────────────────────────────────────────────────
cron.schedule('*/15 * * * *', () => {
  console.log('[cron] triggered');
  refresh();
});

// ── Cron 4h — Launches ────────────────────────────────────────────────────
cron.schedule('0 */4 * * *', () => {
  console.log('[cron-launches] triggered');
  fetchLaunches().catch(err => console.error('[launches-cron]', err.message));
});

// ── Démarrage ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  refresh().catch(err => console.error('[startup] refresh failed:', err.message));
  fetchLaunches().catch(err => console.error('[startup-launches]', err.message));
});
