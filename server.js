'use strict';

const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const { fetchTodayEvents } = require('./gdelt');
const { enrichEvents }    = require('./enrich');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── État en mémoire ───────────────────────────────────────────────────────
let cache = {
  events:     [],
  lastUpdate: null,
  date:       null,
  status:     'initializing'
};

// ── Refresh GDELT ─────────────────────────────────────────────────────────
async function refresh() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Si déjà à jour et même jour → skip
  if (cache.date === today && cache.status === 'ok' && cache.lastUpdate) {
    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age < 14 * 60 * 1000) {
      console.log('[refresh] skipped — cache fresh');
      return;
    }
  }

  console.log('[refresh] starting...');
  cache.status = 'refreshing';

  try {
    const raw       = await fetchTodayEvents();
    // Limiter Groq aux 200 événements les plus sévères pour rester dans les rate limits
    const MAX_ENRICH = 200;
    const sorted     = [...raw].sort((a, b) => (a.goldstein || 0) - (b.goldstein || 0));
    const toEnrich   = sorted.slice(0, MAX_ENRICH);
    const rest       = sorted.slice(MAX_ENRICH);
    console.log(`[refresh] ${raw.length} raw events — enriching top ${toEnrich.length} with AI...`);
    const enriched   = await enrichEvents(toEnrich);
    const events     = [...enriched, ...rest];
    cache.events    = events;
    cache.lastUpdate = new Date().toISOString();
    cache.date      = today;
    cache.status    = 'ok';
    console.log(`[refresh] done — ${events.length} events after AI enrichment`);
  } catch (err) {
    cache.status = 'error';
    console.error('[refresh] failed:', err.message);
    // Garde les données précédentes si elles existent
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

app.get('/health', (req, res) => {
  res.json({
    ok:         cache.status === 'ok',
    status:     cache.status,
    events:     cache.events.length,
    lastUpdate: cache.lastUpdate,
    date:       cache.date
  });
});

// ── Endpoint refresh manuel ───────────────────────────────────────────────
app.post('/refresh', (req, res) => {
  res.json({ ok: true, message: 'refresh triggered' });
  cache.lastUpdate = null; // force skip du cache
  refresh().catch(err => console.error('[manual-refresh] failed:', err.message));
});

// ── Cron 15 min ───────────────────────────────────────────────────────────
cron.schedule('*/15 * * * *', () => {
  console.log('[cron] triggered');
  refresh();
});

// ── Démarrage ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  // Lancer le refresh en arrière-plan — ne pas bloquer le démarrage
  refresh().catch(err => console.error('[startup] refresh failed:', err.message));
});
