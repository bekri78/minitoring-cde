'use strict';
/**
 * firms.js — Points chauds satellitaires NASA FIRMS (VIIRS, quasi temps réel).
 *
 * Détections thermiques des dernières 24 h sur les zones suivies (Ukraine-Russie,
 * Moyen-Orient, Soudan-Corne, Sahel-Libye, Myanmar). Incendies, frappes sur
 * dépôts ou raffineries, torchères, feux agricoles : à recouper.
 *
 * Clé : variable FIRMS_MAP_KEY (gratuite, 5000 requêtes / 10 min).
 * API : https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/{W,S,E,N}/{JOURS}
 *
 * Réduction : confiance haute ou nominale, regroupement en cellules de 0,1°
 * (~10 km), cellules gardées si ≥ 3 détections ou ≥ 20 MW, 400 au plus,
 * les plus puissantes d'abord.
 */

const fs   = require('fs');
const path = require('path');

const API        = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const SOURCES    = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT'];
const CACHE_DIR  = process.env.CACHE_DIR || '/data';
const CACHE_FILE = path.join(CACHE_DIR, 'firms.json');
const CELL       = 0.1;
const MAX_CELLS  = 400;

const ZONES = [
  { id: 'ukr', name: 'Ukraine – Russie',  box: [22, 44, 50, 58] },
  { id: 'moy', name: 'Moyen-Orient',      box: [32, 12, 63, 42] },
  { id: 'sou', name: 'Soudan – Corne',    box: [14, 2, 52, 23] },
  { id: 'sah', name: 'Sahel – Libye',     box: [-18, 8, 25, 33] },
  { id: 'mya', name: 'Myanmar',           box: [92, 9, 102, 29] },
];

let cache = { cells: [], lastUpdate: null, status: 'initializing' };
let isFetching = false;

// CSV FIRMS → objets (en-tête en 1re ligne)
function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (lines.length < 2 || !/latitude/i.test(lines[0])) return [];
  const h = lines[0].split(',').map(s => s.trim().toLowerCase());
  return lines.slice(1).map(l => {
    const v = l.split(','), o = {};
    h.forEach((k, i) => { o[k] = v[i]; });
    return o;
  });
}

function keep(d) {
  const c = String(d.confidence || '').toLowerCase();
  const frp = Number(d.frp) || 0;
  // VIIRS : h = haute, n = nominale (l'essentiel des détections), l = basse (écartée)
  return c === 'h' || c === 'high' || c === 'n' || c === 'nominal' || Number(c) >= 80 || (c === 'l' && frp >= 50);
}

function utcIso(date, time) {
  const t = String(time || '').padStart(4, '0');
  const iso = `${date}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`;
  return isNaN(Date.parse(iso)) ? null : iso;
}

// Regroupe les détections en cellules de 0,1°
function aggregate(rows, zoneName) {
  const cells = new Map();
  for (const d of rows) {
    const lat = Number(d.latitude), lon = Number(d.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !keep(d)) continue;
    const key = Math.floor(lat / CELL) + ':' + Math.floor(lon / CELL);
    const frp = Number(d.frp) || 0;
    const at = utcIso(d.acq_date, d.acq_time);
    let c = cells.get(key);
    if (!c) cells.set(key, c = { n: 0, sumLat: 0, sumLon: 0, frpSum: 0, frpMax: 0, last: null, night: 0, zone: zoneName });
    c.n++; c.sumLat += lat; c.sumLon += lon; c.frpSum += frp;
    if (frp > c.frpMax) c.frpMax = frp;
    if (at && (!c.last || at > c.last)) c.last = at;
    if (String(d.daynight).toUpperCase() === 'N') c.night++;
  }
  return [...cells.entries()].map(([key, c]) => ({
    id: 'firms-' + key,
    lat: Math.round(c.sumLat / c.n * 1000) / 1000,
    lon: Math.round(c.sumLon / c.n * 1000) / 1000,
    count: c.n,
    frpMax: Math.round(c.frpMax),
    frpSum: Math.round(c.frpSum),
    level: c.frpMax >= 100 ? 'fort' : c.frpMax >= 30 ? 'moyen' : 'faible',
    last: c.last,
    night: c.night > c.n / 2,
    zone: c.zone,
  }));
}

function select(cells) {
  const byId = new Map();
  for (const c of cells) {
    if (c.count < 3 && c.frpMax < 20) continue;
    const p = byId.get(c.id);
    if (!p || c.frpMax > p.frpMax) byId.set(c.id, p ? { ...c, count: Math.max(c.count, p.count) } : c);
  }
  return [...byId.values()].sort((a, b) => b.frpMax - a.frpMax || b.count - a.count).slice(0, MAX_CELLS);
}

function saveToDisk() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); }
  catch (err) { console.warn('[firms] save failed:', err.message); }
}
try {
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  if (raw && raw.lastUpdate && Array.isArray(raw.cells)) cache = { ...raw, status: 'cached' };
} catch (_) {}

async function fetchFirms(fetchImpl = fetch, key = process.env.FIRMS_MAP_KEY) {
  if (!key) { cache = { ...cache, status: 'no-key' }; return cache; }
  if (isFetching) return cache;
  isFetching = true;
  try {
    const all = []; let ok = 0; const stat = { rows: 0, h: 0, n: 0, l: 0 };
    for (const z of ZONES) {
      for (const src of SOURCES) {
        const url = `${API}/${key}/${src}/${z.box.join(',')}/1`;
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45000);
        try {
          const res = await fetchImpl(url, { headers: { 'User-Agent': 'OGMA/1.0 (veille OSINT)' }, signal: ctrl.signal });
          const text = await res.text();
          if (!res.ok || /invalid|error/i.test(text.slice(0, 80)) && !/latitude/i.test(text.slice(0, 80))) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 60));
          const rows = parseCsv(text);
          rows.forEach(r => { stat.rows++; const c = String(r.confidence || '').toLowerCase()[0]; if (stat[c] !== undefined) stat[c]++; });
          all.push(...aggregate(rows, z.name)); ok++;
        } catch (err) {
          console.warn(`[firms] ${z.id}/${src} :`, err.message);
        } finally { clearTimeout(t); }
      }
    }
    if (!ok) throw new Error('aucune zone récupérée');
    const cells = select(all);
    cache = { cells, lastUpdate: new Date().toISOString(), status: 'ok' };
    saveToDisk();
    console.log(`[firms] ${cells.length} foyers (forts ${cells.filter(c => c.level === 'fort').length}) — ${stat.rows} détections brutes (h ${stat.h}, n ${stat.n}, l ${stat.l}) sur ${ok} requêtes`);
  } catch (err) {
    console.warn('[firms] fetch failed:', err.message);
    cache = { ...cache, status: cache.cells.length ? 'stale' : 'error' };
  } finally { isFetching = false; }
  return cache;
}

function getCache() { return cache; }

module.exports = { fetchFirms, getCache, ZONES, _parseCsv: parseCsv, _aggregate: aggregate, _select: select };
