'use strict';

/**
 * signals.js — Synthèse géopolitique par zone via Groq (Llama 3.1 8B gratuit)
 *
 * Pipeline :
 *   1. Reçoit les events GDELT bruts du cache
 *   2. Les groupe par cellule géographique de 2° (≈ 220 km)
 *   3. Pour chaque cluster de ≥ 3 events : appel Groq → summary + key_points
 *   4. Cache en mémoire 4h
 */

const GROQ_API_KEY = process.env.groq;
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.1-8b-instant';

const CACHE_TTL_MS  = 4 * 60 * 60 * 1000; // 4h
const GRID_DEG      = 2;   // cellule 2° ≈ 220 km
const MIN_EVENTS    = 3;   // minimum d'events pour générer un résumé
const MAX_CLUSTERS  = 30;  // réduit pour respecter le rate limit Groq free tier
const CONCURRENCY   = 1;   // 1 appel à la fois — Groq free = ~30 req/min

let signalsCache = { signals: [], lastUpdate: null };
let isRunning    = false;

// ── Grouper les events par cellule 2° ─────────────────────────────────────
function groupByCells(events) {
  const cells = new Map();

  for (const e of events) {
    const lat = e.lat, lon = e.lon;
    if (lat == null || lon == null) continue;

    const cellLat = Math.round(lat / GRID_DEG) * GRID_DEG;
    const cellLon = Math.round(lon / GRID_DEG) * GRID_DEG;
    const key     = `${cellLat},${cellLon}`;

    if (!cells.has(key)) {
      cells.set(key, { cellLat, cellLon, events: [] });
    }
    cells.get(key).events.push(e);
  }

  // Trier par nombre d'events desc, garder seulement les clusters significatifs
  return Array.from(cells.values())
    .filter(c => c.events.length >= MIN_EVENTS)
    .sort((a, b) => b.events.length - a.events.length)
    .slice(0, MAX_CLUSTERS);
}

// ── Pool de concurrence ────────────────────────────────────────────────────
function makePool(n) {
  let running = 0;
  const queue = [];
  function next() {
    while (running < n && queue.length) {
      running++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(resolve, reject).finally(() => { running--; next(); });
    }
  }
  return fn => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}
const pool = makePool(CONCURRENCY);

function stripCodeFences(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractBalancedJsonObject(text) {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseSignalResponse(text) {
  const jsonText = extractBalancedJsonObject(text);
  if (!jsonText) throw new Error('no JSON object in response');

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`invalid JSON: ${err.message}`);
  }

  return {
    location_name: String(parsed.location_name || '').trim(),
    summary: String(parsed.summary || '').trim(),
    key_points: Array.isArray(parsed.key_points)
      ? parsed.key_points
        .slice(0, 5)
        .map(item => ({
          point: String(item?.point || '').trim(),
          category: String(item?.category || 'conflict').trim().toLowerCase(),
        }))
        .filter(item => item.point)
      : [],
  };
}

// ── Appel Groq pour un cluster ─────────────────────────────────────────────
async function summarizeCluster(cluster) {
  // Prendre les 10 meilleurs events du cluster (par score)
  const top = [...cluster.events]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10);

  const eventLines = top.map(e =>
    `- ${(e.title || e.url || '').slice(0, 120)}`
  ).join('\n');

  const locationName = top[0]?.country || `${cluster.cellLat}°, ${cluster.cellLon}°`;

  const prompt = `You are an intelligence analyst. Below are ${top.length} news headlines from the "${locationName}" region in the last 24 hours.

Headlines:
${eventLines}

Respond with a JSON object only, no markdown:
{
  "location_name": "precise location name (city, region or country)",
  "summary": "2-3 sentence operational summary of the situation",
  "key_points": [
    {"point": "concise factual statement", "category": "military|conflict|terrorism|diplomatic|economic"}
  ]
}

Rules: max 5 key_points, English only, factual and concise, no speculation.`;

  // Retry avec backoff sur 429 (rate limit Groq free tier)
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(attempt * 8000); // 8s, 16s

    const resp = await fetch(GROQ_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:           GROQ_MODEL,
        messages:        [{ role: 'user', content: prompt }],
        temperature:     0,
        max_tokens:      400,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (resp.status === 429) { lastErr = new Error('Groq HTTP 429'); continue; }
    if (!resp.ok) throw new Error(`Groq HTTP ${resp.status}`);

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    try {
      return parseSignalResponse(text);
    } catch (parseErr) {
      // Retry on bad JSON — model sometimes returns empty or truncated
      lastErr = parseErr;
      continue;
    }
  }
  throw lastErr;
}

// ── Générer tous les signals ───────────────────────────────────────────────
async function buildSignals(events) {
  if (!GROQ_API_KEY) {
    console.warn('[signals] GROQ_API_KEY not set — skipping');
    return [];
  }
  if (!events?.length) return [];

  const clusters = groupByCells(events);
  console.log(`[signals] ${clusters.length} clusters to summarize (from ${events.length} events)`);

  const results = await Promise.allSettled(
    clusters.map(cluster => pool(async () => {
      try {
        const ai = await summarizeCluster(cluster);
        return {
          id:            `sig_${cluster.cellLat}_${cluster.cellLon}`,
          lat:           cluster.cellLat,
          lng:           cluster.cellLon,
          location_name: ai.location_name || cluster.events[0]?.country || '',
          country:       cluster.events[0]?.country || '',
          event_count:   cluster.events.length,
          summary:       ai.summary || '',
          key_points:    (ai.key_points || []).slice(0, 5),
        };
      } catch (err) {
        console.warn(`[signals] cluster ${cluster.cellLat},${cluster.cellLon} failed: ${err.message}`);
        return null;
      }
    }))
  );

  const signals = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  console.log(`[signals] done — ${signals.length} signals generated`);
  return signals;
}

// ── Refresh du cache ───────────────────────────────────────────────────────
async function refreshSignals(events) {
  if (isRunning) return;
  isRunning = true;
  try {
    const signals = await buildSignals(events);
    signalsCache = { signals, lastUpdate: new Date().toISOString() };
  } finally {
    isRunning = false;
  }
}

function getSignalsCache() { return signalsCache; }

function isStale() {
  if (!signalsCache.lastUpdate) return true;
  return Date.now() - new Date(signalsCache.lastUpdate).getTime() > CACHE_TTL_MS;
}

module.exports = { refreshSignals, getSignalsCache, isStale };
