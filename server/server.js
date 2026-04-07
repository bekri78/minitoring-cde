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
const { fetchQuakes, getCache: getQuakeCache }                       = require('./earthquakes');
const { fetchSpaceWeather, getCache: getSwCache }                    = require('./spaceweather');
const { fetchMilitary, getCache: getMilCache }                       = require('./military-aircraft');
const { startMilitaryShips, getCache: getShipCache }                 = require('./military-ships');
const { runPipeline }                                                = require('./pipeline');
const { fetchAircraftPhoto }                                         = require('./planespotters');
const { fetchShipPhoto }                                             = require('./shipphotos');
const { attachNearbyEvents }                                         = require('./proximity');
const { refreshSignals, getSignalsCache, isStale }                   = require('./signals');
const { normalizeTitleWithGemini }                                   = require('./gemini-normalizer');

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
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — réduit les appels OpenAI de ~480 à ~52/jour

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
    const raw        = await fetchTodayEvents();
    const MAX_ENRICH = 800; // plus d'événements → meilleure couverture géographique

    // Diversité géographique : garder les zones stratégiques (Russie, Chine, etc.)
    const STRATEGIC = new Set(['RS','CH','KN','KS','TW','VM','IR','SY','UP','IZ','AF','PK','LY','YM','SU']);
    const STRATEGIC_MIN = 300; // 300/800 réservés aux zones stratégiques
    const rawSorted = [...raw].sort((a, b) => b.score - a.score);
    const rawStrategic = rawSorted.filter(e => STRATEGIC.has(e.countryCode));
    const rawOthers    = rawSorted.filter(e => !STRATEGIC.has(e.countryCode));
    const toEnrich = [
      ...rawOthers.slice(0, MAX_ENRICH - Math.min(rawStrategic.length, STRATEGIC_MIN)),
      ...rawStrategic.slice(0, STRATEGIC_MIN),
    ].sort((a, b) => b.score - a.score);

    console.log(`[refresh] ${raw.length} raw events — enriching top ${toEnrich.length} with AI (rest discarded)...`);
    const events     = await enrichEvents(toEnrich);
    cache.events     = events;
    cache.lastUpdate = new Date().toISOString();
    cache.date       = today;
    cache.status     = 'ok';
    saveToDisk(today, events, cache.lastUpdate);
    console.log(`[refresh] done — ${events.length} events after AI enrichment`);
    // Lancer la synthèse Groq en arrière-plan (pas besoin d'attendre)
    refreshSignals(events).catch(err => console.error('[signals]', err.message));
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

app.post('/translate-title', async (req, res) => {
  try {
    const translated = await normalizeTitleWithGemini(req.body || {});
    res.json(translated);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || 'translation_failed',
    });
  }
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

app.get('/earthquakes', (req, res) => {
  const c = getQuakeCache();
  res.json({
    quakes:     c.quakes,
    count:      c.quakes.length,
    lastUpdate: c.lastUpdate,
    status:     c.lastUpdate ? 'ok' : 'initializing',
  });
});

app.get('/spaceweather', (req, res) => {
  const c = getSwCache();
  res.json({
    kp:         c.kp,
    scales:     c.scales,
    alerts:     c.alerts,
    lastUpdate: c.lastUpdate,
    status:     c.lastUpdate ? 'ok' : 'initializing',
  });
});

app.get('/military-aircraft', (req, res) => {
  const c = getMilCache();
  res.json({
    aircraft:   c.aircraft,
    count:      c.count,
    lastUpdate: c.lastUpdate,
    status:     c.lastUpdate ? 'ok' : 'initializing',
  });
});

// ── Avions militaires enrichis avec activité détectée ─────────────────────
app.get('/api/aircraft/military', (req, res) => {
  const c = getMilCache();
  const aircraft = (c.aircraft || []).map(ac => ({
    hex:                  ac.id,
    flight:               ac.callsign,
    lat:                  ac.lat,
    lon:                  ac.lon,
    alt_baro:             ac.altFt,
    gs:                   ac.speed,
    track:                ac.track,
    t:                    ac.type,
    activity:             ac.activity             ?? null,
    activity_confidence:  ac.activity_confidence  ?? 0,
  }));
  res.json({
    aircraft,
    count:      aircraft.length,
    lastUpdate: c.lastUpdate,
    status:     c.lastUpdate ? 'ok' : 'initializing',
  });
});

app.get('/military-ships', (req, res) => {
  const c = getShipCache();
  res.json(c);
});

// ── Signals géopolitiques (synthèse Groq par zone) ────────────────────────
app.get('/api/signals', (req, res) => {
  const c = getSignalsCache();
  res.json({
    signals:    c.signals,
    count:      c.signals.length,
    lastUpdate: c.lastUpdate,
    status:     c.lastUpdate ? 'ok' : 'initializing',
  });
});

// ── Photo avion via planespotters.net ─────────────────────────────────────
app.get('/flights/aircraft', async (req, res) => {
  const { icao24 } = req.query;
  if (!icao24) return res.status(400).json({ error: 'icao24 required' });
  const photo = await fetchAircraftPhoto(icao24);
  res.json(photo || {});
});

// ── Photo / infos navire via MarineTraffic + flagcdn ──────────────────────
app.get('/ships/vessel', async (req, res) => {
  const { mmsi, country } = req.query;
  if (!mmsi) return res.status(400).json({ error: 'mmsi required' });
  const info = await fetchShipPhoto(mmsi, country || '');
  res.json(info || {});
});

// ── Unified tracks endpoint (OSINT fusion pipeline) ─────────────────────
app.get('/tracks', (req, res) => {
  const { domain, country, minTier } = req.query;
  const aircraft = getMilCache().aircraft || [];
  const ships    = getShipCache().ships   || [];
  const result   = runPipeline({ aircraft, ships, domain, country, minTier });
  const radius   = req.query.radius ? Number(req.query.radius) : 300;
  result.tracks  = attachNearbyEvents(result.tracks, cache.events, radius);
  res.json(result);
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

// ── Cron 6h — Launches ────────────────────────────────────────────────────
cron.schedule('0 */6 * * *', () => {
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

// ── Cron 15min — Séismes USGS ─────────────────────────────────────────────────
cron.schedule('*/15 * * * *', () => {
  fetchQuakes().catch(err => console.error('[earthquakes-cron]', err.message));
});

// ── Cron 15min — Météo spatiale NOAA ──────────────────────────────────────────
cron.schedule('*/15 * * * *', () => {
  fetchSpaceWeather().catch(err => console.error('[spaceweather-cron]', err.message));
});

// ── Cron 5min — Avions militaires OpenSky ─────────────────────────────────────
cron.schedule('*/5 * * * *', () => {
  fetchMilitary().catch(err => console.error('[military-aircraft-cron]', err.message));
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
  fetchQuakes().catch(err => console.error('[startup-earthquakes]', err.message));
  fetchSpaceWeather().catch(err => console.error('[startup-spaceweather]', err.message));
  fetchMilitary().catch(err => console.error('[startup-military]', err.message));
  startMilitaryShips();
});
