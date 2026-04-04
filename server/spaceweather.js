'use strict';

const SCALES_URL    = 'https://services.swpc.noaa.gov/products/noaa-scales.json';
const KP_URL        = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';
const ALERTS_URL    = 'https://services.swpc.noaa.gov/products/alerts.json';
const CACHE_MAX_AGE = 15 * 60 * 1000; // 15min

let cache = {
  kp:         null,   // dernier indice Kp (0-9)
  scales:     { G: 0, S: 0, R: 0 },
  alerts:     [],
  lastUpdate: null,
};

let isFetching = false;

// ── Extraction de la première ligne significative d'une alerte ────────────────
function extractHeadline(message) {
  const lines = (message || '').split('\n').map(l => l.trim()).filter(Boolean);
  // Ignorer les lignes de code interne (ex: "Space Weather Message Code: WATA20")
  const headline = lines.find(l => !l.startsWith('Space Weather Message Code') && !l.startsWith('Issue Time')) || lines[0] || '';
  return headline.slice(0, 120);
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchSpaceWeather() {
  if (isFetching) {
    console.log('[spaceweather] already fetching — skipped');
    return;
  }

  if (cache.lastUpdate) {
    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age < CACHE_MAX_AGE) {
      console.log(`[spaceweather] skipped — cache ${Math.round(age / 60000)}min old`);
      return;
    }
  }

  isFetching = true;
  console.log('[spaceweather] fetching from NOAA...');

  try {
    const [scalesRes, kpRes, alertsRes] = await Promise.all([
      fetch(SCALES_URL),
      fetch(KP_URL),
      fetch(ALERTS_URL),
    ]);

    // ── Echelles G/S/R du jour courant ────────────────────────────────────────
    if (scalesRes.ok) {
      const scales  = await scalesRes.json();
      const current = scales['0'] || {};
      cache.scales = {
        G: Number(current.G?.Scale) || 0,
        S: Number(current.S?.Scale) || 0,
        R: Number(current.R?.Scale) || 0,
      };
    }

    // ── Dernier indice Kp ─────────────────────────────────────────────────────
    if (kpRes.ok) {
      const rows = await kpRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const last = rows[rows.length - 1];
        // Format objet : { time_tag, Kp } ou { time_tag, estimated_kp }
        if (last && typeof last === 'object') {
          cache.kp = Number(last.Kp ?? last.estimated_kp ?? last.kp) || null;
        }
        // Format tableau : [[header], [time, kp], ...]
        else if (Array.isArray(last)) {
          cache.kp = Number(last[1]) || null;
        }
      }
    }

    // ── Alertes actives (< 48h) ───────────────────────────────────────────────
    if (alertsRes.ok) {
      const alerts = await alertsRes.json();
      const cutoff = Date.now() - 48 * 3600 * 1000;
      cache.alerts = (Array.isArray(alerts) ? alerts : [])
        .filter(a => a.issue_datetime && new Date(a.issue_datetime).getTime() > cutoff)
        .slice(0, 8)
        .map(a => ({
          id:       a.product_id || a.issue_datetime,
          time:     a.issue_datetime,
          headline: extractHeadline(a.message || ''),
        }));
    }

    cache.lastUpdate = new Date().toISOString();
    console.log(`[spaceweather] ok — Kp=${cache.kp?.toFixed(1)} G${cache.scales.G}/S${cache.scales.S}/R${cache.scales.R} alerts=${cache.alerts.length}`);
  } catch (err) {
    console.error('[spaceweather] fetch failed:', err.message);
  } finally {
    isFetching = false;
  }
}

function getCache() { return cache; }

module.exports = { fetchSpaceWeather, getCache };
