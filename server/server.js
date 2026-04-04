'use strict';

const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const fs      = require('fs');
const path    = require('path');
const { fetchTodayEvents }      = require('./gdelt');
const { enrichEvents }          = require('./enrich');
const { fetchAll: fetchLaunches, getCache: getLaunchCache } = require('./launches');
const { fetchDecay, getCache: getDecayCache, fetchTip, getTipCache } = require('./spacetrack');

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
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1h

async function refresh(force = false) {
  if (isRefreshing) {
    console.log('[refresh] skipped — already in progress');
    return;
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Skip si le dernier enrichissement date de moins d'1h (sauf force)
  if (!force && cache.status === 'ok' && cache.lastUpdate) {
    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age < REFRESH_INTERVAL_MS) {
      console.log(`[refresh] skipped — last enrichment ${Math.round(age / 60000)}min ago`);
      return;
    }
  }

  isRefreshing = true;

  // Charger depuis le disque si disponible (évite l'enrichissement IA au restart)
  if (!force) {
    const disk = loadFromDisk(today);
    if (disk && disk.lastUpdate) {
      const age = Date.now() - new Date(disk.lastUpdate).getTime();
      if (age < REFRESH_INTERVAL_MS) {
        cache.events     = disk.events;
        cache.lastUpdate = disk.lastUpdate;
        cache.date       = today;
        cache.status     = 'ok';
        isRefreshing     = false;
        console.log(`[refresh] restored from disk — ${disk.events.length} events (${Math.round(age / 60000)}min old)`);
        return;
      }
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

app.get('/decay', (req, res) => {
  const c = getDecayCache();
  res.json({
    objects:    c.objects,
    count:      c.objects.length,
    lastUpdate: c.lastUpdate,
    status:     c.lastUpdate ? 'ok' : 'initializing',
  });
});

app.get('/tip', (req, res) => {
  const c = getTipCache();
  res.json({
    objects:    c.objects,
    count:      c.objects.length,
    lastUpdate: c.lastUpdate,
    status:     c.lastUpdate ? 'ok' : 'initializing',
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

// ── Historique — résumé par jour ──────────────────────────────────────────
app.get('/history', (req, res) => {
  try {
    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => /^events-\d{8}\.json$/.test(f))
      .sort();

    const history = files.map(file => {
      try {
        const raw    = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
        const events = raw.events || [];
        const categories = {};
        const severities  = {};
        for (const e of events) {
          const cat = e.category || 'incident';
          const sev = e.severity || 'LOW';
          categories[cat] = (categories[cat] || 0) + 1;
          severities[sev]  = (severities[sev]  || 0) + 1;
        }
        return {
          date:       file.replace('events-', '').replace('.json', ''),
          count:      events.length,
          lastUpdate: raw.lastUpdate || null,
          categories,
          severities,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ── Cron 1h — GDELT ───────────────────────────────────────────────────────
cron.schedule('0 * * * *', () => {
  console.log('[cron] triggered');
  refresh();
});

// ── Cron 4h — Launches ────────────────────────────────────────────────────
cron.schedule('0 */4 * * *', () => {
  console.log('[cron-launches] triggered');
  fetchLaunches().catch(err => console.error('[launches-cron]', err.message));
});

// ── Cron 1x/jour à 06:00 UTC — DECAY ─────────────────────────────────────
cron.schedule('0 6 * * *', () => {
  console.log('[cron-decay] triggered');
  fetchDecay().catch(err => console.error('[decay-cron]', err.message));
});

// ── Cron 6h — TIP (décalé de 3h par rapport à DECAY pour éviter le double login) ──
cron.schedule('0 3,9,15,21 * * *', () => {
  console.log('[cron-tip] triggered');
  fetchTip().catch(err => console.error('[tip-cron]', err.message));
});

// ── Démarrage ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  refresh().catch(err => console.error('[startup] refresh failed:', err.message));
  fetchLaunches().catch(err => console.error('[startup-launches]', err.message));
  // Sérialiser les appels Space-Track pour éviter la concurrence sur la session
  fetchDecay()
    .then(() => fetchTip())
    .catch(err => console.error('[startup-spacetrack]', err.message));
});
