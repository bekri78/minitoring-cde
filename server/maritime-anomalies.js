'use strict';

const fs = require('fs');
const path = require('path');

/* ── config ─────────────────────────────────────────────────── */
const CACHE_FILE = path.join(process.env.CACHE_DIR || '/data', 'maritime-anomalies.json');
const GFW_BASE_URL = 'https://gateway.api.globalfishingwatch.org/v3';
const SOURCE_TOKEN = String(process.env.GFW_API_TOKEN || process.env.MARITIME_ANOMALY_TOKEN || '').trim();
const SOURCE_NAME = 'GlobalFishingWatch';
const DEFAULT_DATASETS = [
  'public-global-fishing-events:latest',
  'public-global-loitering-events:latest',
  'public-global-encounters-events:latest',
  'public-global-gaps-events:latest',
];
const EVENTS_PER_REQUEST = 99;
const MAX_EVENTS = Number(process.env.GFW_MAX_EVENTS || 500);

/* ── env helpers ────────────────────────────────────────────── */
function readJsonEnv(name, fallback) {
  try {
    const raw = String(process.env[name] || '').trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function configuredDatasets() {
  const raw = String(process.env.GFW_DATASETS || '').trim();
  if (!raw) return DEFAULT_DATASETS;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function configuredQueryParams() {
  return readJsonEnv('GFW_EVENTS_QUERY', {});
}

function defaultDateRange() {
  const end = new Date();
  const days = Number(process.env.GFW_DATE_RANGE_DAYS) || 90;
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

/* ── cache ──────────────────────────────────────────────────── */
let cache = {
  anomalies: [],
  lastUpdate: null,
  status: SOURCE_TOKEN ? 'initializing' : 'not_configured',
  source: SOURCE_NAME,
  error: null,
  meta: null,
};

function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(raw?.anomalies)) {
      cache = {
        anomalies: raw.anomalies,
        lastUpdate: raw.lastUpdate || null,
        status: raw.status || (SOURCE_TOKEN ? 'ok' : 'not_configured'),
        source: raw.source || SOURCE_NAME,
        error: null,
        meta: raw.meta || null,
      };
    }
  } catch {}
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {}
}

/* ── GFW event type mapping ─────────────────────────────────── */
function mapEventType(raw) {
  const t = String(raw || '').toLowerCase();
  if (t.includes('gap'))       return 'dark_shipping';
  if (t.includes('encounter')) return 'vessel_encounter';
  if (t.includes('loiter'))    return 'loitering';
  if (t.includes('fishing'))   return 'fishing_activity';
  if (t.includes('port'))      return 'port_visit';
  return 'maritime_anomaly';
}

const TYPE_CONFIDENCE = {
  dark_shipping:    80,
  vessel_encounter: 70,
  loitering:        65,
  fishing_activity: 50,
  port_visit:       40,
  maritime_anomaly: 55,
};

/* ── normalisation ──────────────────────────────────────────── */
function normalizeGfwEvent(ev, index) {
  const lat = Number(ev.position?.lat ?? ev.lat ?? ev.latitude);
  const lon = Number(ev.position?.lon ?? ev.position?.lng ?? ev.lon ?? ev.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const type = mapEventType(ev.type);
  const timestamp = ev.start || ev.end || ev.timestamp || new Date().toISOString();

  return {
    id: String(ev.id || `gfw-${type}-${index}`),
    type,
    lat,
    lon,
    timestamp,
    confidenceScore: TYPE_CONFIDENCE[type] || 55,
    source: SOURCE_NAME,
    vesselId: ev.vessel?.id || ev.vessel?.ssvid || null,
    details: {
      gfwType: ev.type,
      vessel: ev.vessel
        ? { name: ev.vessel.name, flag: ev.vessel.flag, type: ev.vessel.type }
        : null,
      durationMin: ev.end && ev.start
        ? Math.round((new Date(ev.end) - new Date(ev.start)) / 60000)
        : null,
      regions: ev.regions || null,
    },
  };
}

/* ── dedup ──────────────────────────────────────────────────── */
function dedupeAnomalies(anomalies) {
  const byKey = new Map();
  for (const a of anomalies) {
    const key = [a.type, Math.round(a.lat * 10) / 10, Math.round(a.lon * 10) / 10, a.vesselId || ''].join(':');
    const existing = byKey.get(key);
    if (!existing || a.confidenceScore > existing.confidenceScore) byKey.set(key, a);
  }
  return [...byKey.values()];
}

/* ── URL + body builder (V3 = POST with JSON body) ─────────── */
function buildEventsRequest(datasets) {
  const url = new URL(`${GFW_BASE_URL}/events`);
  url.searchParams.set('limit', String(EVENTS_PER_REQUEST));
  url.searchParams.set('offset', '0');

  const extra = configuredQueryParams();
  for (const [k, v] of Object.entries(extra)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const range = defaultDateRange();
  const body = {
    datasets,
    startDate: range.start,
    endDate: range.end,
  };

  return { url: url.toString(), body };
}

/* ── fetcher ────────────────────────────────────────────────── */
async function fetchGfwEvents(datasets) {
  const { url, body } = buildEventsRequest(datasets);

  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `Bearer ${SOURCE_TOKEN}`,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GFW ${resp.status} ${body.slice(0, 300)}`.trim());
  }

  const payload = await resp.json();
  const entries =
    payload.entries ||
    payload.data ||
    payload.events ||
    (Array.isArray(payload) ? payload : []);

  return entries.map((ev, i) => normalizeGfwEvent(ev, i)).filter(Boolean);
}

/* ── main refresh ───────────────────────────────────────────── */
async function fetchMaritimeAnomalies() {
  if (!SOURCE_TOKEN) {
    cache.status = 'not_configured';
    cache.error = null;
    cache.meta = { provider: SOURCE_NAME, configured: false, datasets: configuredDatasets() };
    return cache;
  }

  cache.status = 'refreshing';
  cache.error = null;

  try {
    const datasets = configuredDatasets();
    const events = await fetchGfwEvents(datasets);
    const anomalies = dedupeAnomalies(events).slice(0, MAX_EVENTS);

    cache = {
      anomalies,
      lastUpdate: new Date().toISOString(),
      status: 'ok',
      source: SOURCE_NAME,
      error: null,
      meta: {
        provider: SOURCE_NAME,
        configured: true,
        endpoint: '/events',
        datasets,
        count: anomalies.length,
      },
    };
    saveCache();
  } catch (err) {
    cache.status = cache.anomalies.length ? 'degraded' : 'error';
    cache.error = err.message;
    cache.meta = {
      ...(cache.meta || {}),
      provider: SOURCE_NAME,
      endpoint: '/events',
      datasets: configuredDatasets(),
      configured: true,
    };
  }

  return cache;
}

function getMaritimeAnomaliesCache() {
  return cache;
}

loadCache();

module.exports = { fetchMaritimeAnomalies, getMaritimeAnomaliesCache };
