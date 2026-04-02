'use strict';

const express = require('express');
const cors    = require('cors');
const cron    = require('node-cron');
const { fetchTodayEvents } = require('./gdelt');

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
    const events    = await fetchTodayEvents();
    cache.events    = events;
    cache.lastUpdate = new Date().toISOString();
    cache.date      = today;
    cache.status    = 'ok';
    console.log(`[refresh] done — ${events.length} events`);
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

// ── Cron 15 min ───────────────────────────────────────────────────────────
cron.schedule('*/15 * * * *', () => {
  console.log('[cron] triggered');
  refresh();
});

// ── Démarrage ─────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[server] listening on port ${PORT}`);
  await refresh();
});
