'use strict';
/**
 * gnss.js — Brouillage et leurrage GNSS (GPS) vus par les avions.
 *
 * 1. Stanford GPS Lab (rfi.stanford.edu, licence CC BY-NC 4.0, attribution obligatoire :
 *    « Source : Stanford GPS Lab, rfi.stanford.edu »). Fichiers JSON publics, sans clé,
 *    publiés avec 2 à 3 jours de décalage :
 *      jamming/AAAA/MM/JJ/heatmap.json   hexagones H3 (niveau 4, ~22 km) : avions à
 *                                        position dégradée (NIC bas) / avions vus
 *      jamming/AAAA/MM/JJ/events.json    sources de brouillage localisées (vols touchés)
 *      spoofing/AAAA/MM/JJ/events.json   épisodes de leurrage (positions falsifiées)
 * 2. EASA (Data4Safety) : classement des FIR touchées sur 7 jours (page web, mise à jour
 *    irrégulière) — ce qui est signalé par les équipages et les données ADS-B en Europe.
 *
 * Réduction : hexagones gardés si ≥ 10 avions vus et ≥ 10 % dégradés, 1500 au plus.
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const tls  = require('tls');
const { cellToLatLng, cellToBoundary, isValidCell } = require('h3-js');

const BASE       = 'https://waas-nas.stanford.edu/data';
const EASA_URL   = 'https://www.easa.europa.eu/en/domains/air-operations/global-navigation-satellite-system-outages-and-alterations';
const CACHE_DIR  = process.env.CACHE_DIR || '/data';
const CACHE_FILE = path.join(CACHE_DIR, 'gnss.json');
const MIN_SEEN   = 10;
const MIN_RATIO  = 0.10;
const MAX_CELLS  = 1500;
const LOOKBACK   = 7;     // jours remontés pour trouver le dernier fichier publié
const UA         = 'OGMA/1.0 (veille OSINT)';

// Régions grossières pour l'analyste IA et les fenêtres ([O, S, E, N], la première qui contient gagne)
const REGIONS = [
  ['Golfe persique',          [47, 22, 60, 31]],
  ['Méditerranée orientale',  [24, 30, 37, 40]],
  ['Caucase',                 [38, 38, 51, 44]],
  ['Mer Noire – Ukraine',     [22, 40, 42, 53]],
  ['Baltique',                [9, 53, 31, 66]],
  ['Arctique – Barents',      [15, 66, 60, 80]],
  ['Moyen-Orient',            [34, 12, 63, 40]],
  ['Soudan – Corne',          [22, 0, 52, 23]],
  ['Pakistan – Inde',         [60, 8, 90, 37]],
  ['Myanmar – Asie du Sud-Est', [90, 5, 110, 30]],
  ['Mer de Chine – Taïwan',   [110, 15, 135, 45]],
  ['Russie',                  [30, 45, 180, 78]],
];
function regionOf(lat, lon) {
  for (const [name, [w, s, e, n]] of REGIONS) if (lon >= w && lon <= e && lat >= s && lat <= n) return name;
  return '';
}

let cache = { day: null, spoofDay: null, cells: [], events: [], firs: [], easaDate: null, lastUpdate: null, status: 'initializing', easaStatus: 'initializing' };
let isFetching = false;

const r2 = x => Math.round(x * 100) / 100;
const r3 = x => Math.round(x * 1000) / 1000;

function dayPath(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '/');
}
// Jours candidats, du plus récent (hier) au plus ancien
function candidateDays(now = new Date()) {
  const out = [];
  for (let i = 1; i <= LOOKBACK; i++) out.push(dayPath(new Date(now.getTime() - i * 86400000)));
  return out;
}

function levelOf(ratio) { return ratio >= 0.5 ? 'fort' : ratio >= 0.25 ? 'moyen' : 'faible'; }

// Hexagones H3 → cellules allégées (centre, contour, % d'avions dégradés)
function reduceHeatmap(rows) {
  const byCell = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const h = String(r && r.h3Index || '');
    if (!h || !isValidCell(h)) continue;
    const p = byCell.get(h) || { low: 0, total: 0 };
    p.low += Number(r.lowQualityCount) || 0; p.total += Number(r.totalAircraftCount) || 0;
    byCell.set(h, p);
  }
  const out = [];
  for (const [h, p] of byCell) {
    if (p.total < MIN_SEEN) continue;
    const ratio = p.low / p.total;
    if (ratio < MIN_RATIO) continue;
    const [lat, lon] = cellToLatLng(h);
    out.push({
      id: 'gnss-' + h,
      lat: r3(lat), lon: r3(lon),
      b: cellToBoundary(h).map(([a, o]) => [r2(a), r2(o)]),
      pct: Math.round(ratio * 100),
      low: p.low, total: p.total,
      level: levelOf(ratio),
      region: regionOf(lat, lon),
    });
  }
  return out.sort((a, b) => b.pct - a.pct || b.total - a.total).slice(0, MAX_CELLS);
}

function reduceEvents(rows, kind) {
  return (Array.isArray(rows) ? rows : []).map(e => {
    const lat = Number(e.latitude), lon = Number(e.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      id: 'gnss-' + kind + '-' + (e.date || '') + '-' + e.eventId,
      kind,                                   // jam = brouillage, spoof = leurrage
      lat: r3(lat), lon: r3(lon),
      start: e.startTime || null, end: e.endTime || null,
      flights: Number(e.numFltAffected) || 0,
      region: regionOf(lat, lon),
    };
  }).filter(Boolean).sort((a, b) => b.flights - a.flights);
}

// Tableau EASA « impacted FIRs in the last 7 days on JJ/MM/AAAA »
function parseEasa(html) {
  const s = String(html || '');
  const m = s.match(/impacted FIRs in the last 7 days on (\d{2})\/(\d{2})\/(\d{4})([\s\S]*?)<\/table>/i);
  if (!m) return null;
  const date = `${m[3]}-${m[2]}-${m[1]}`;
  const cell = (row, c) => {
    const x = row.match(new RegExp('class="col-' + c + '"[^>]*>([\\s\\S]*?)</td>', 'i'));
    return x ? x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() : '';
  };
  const firs = [];
  for (const row of m[4].split(/<tr\b/i).slice(1)) {
    const icao = cell(row, 'icao');
    if (!/^[A-Z]{4}$/.test(icao)) continue;
    firs.push({
      rank: Number(cell(row, 'rank')) || firs.length + 1,
      region: cell(row, 'region'), icao, name: cell(row, 'name'),
      spoofing: cell(row, 'spoofing') === '*', reported: cell(row, 'reported') === '*',
    });
  }
  return firs.length ? { date, firs } : null;
}

// waas-nas.stanford.edu n'envoie pas son certificat intermédiaire (InCommon RSA Server CA 2,
// signé par USERTrust, valide jusqu'en 2032) : on le fournit pour garder une vérification TLS complète.
let stanfordCa = null;
function stanfordFetch(url, opts = {}) {
  if (!stanfordCa) {
    stanfordCa = [...tls.rootCertificates, fs.readFileSync(path.join(__dirname, 'certs', 'incommon-rsa-server-ca2.pem'), 'utf8')];
  }
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ca: stanfordCa, headers: opts.headers, signal: opts.signal }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
          json: async () => JSON.parse(body), text: async () => body });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}
const defaultFetch = (url, opts) => (url.startsWith(BASE) ? stanfordFetch(url, opts) : fetch(url, opts));

async function getJson(fetchImpl, url, ms = 90000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

// Premier jour publié (du plus récent au plus ancien), arrêt si on retombe sur celui déjà en cache
async function latest(fetchImpl, kind, file, known, now) {
  for (const d of candidateDays(now)) {
    if (d === known) return null;
    const j = await getJson(fetchImpl, `${BASE}/${kind}/${d}/${file}.json`);
    if (j && j.data) return { day: d, data: j.data };
  }
  return null;
}

function saveToDisk() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); }
  catch (err) { console.warn('[gnss] save failed:', err.message); }
}
try {
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  if (raw && raw.lastUpdate && Array.isArray(raw.cells)) cache = { ...cache, ...raw, status: 'cached' };
} catch (_) {}

async function fetchStanford(fetchImpl, now) {
  let changed = false;
  const hm = await latest(fetchImpl, 'jamming', 'heatmap', cache.day, now);
  if (hm) {
    const cells = reduceHeatmap(hm.data);
    let jam = [];
    try { const ev = await getJson(fetchImpl, `${BASE}/jamming/${hm.day}/events.json`, 30000); jam = reduceEvents(ev && ev.data, 'jam'); }
    catch (err) { console.warn('[gnss] events brouillage :', err.message); }
    cache = { ...cache, day: hm.day, cells, events: jam.concat(cache.events.filter(e => e.kind === 'spoof')) };
    changed = true;
  }
  const sp = await latest(fetchImpl, 'spoofing', 'events', cache.spoofDay, now);
  if (sp) {
    cache = { ...cache, spoofDay: sp.day, events: cache.events.filter(e => e.kind === 'jam').concat(reduceEvents(sp.data, 'spoof')) };
    changed = true;
  }
  return changed;
}

async function fetchEasa(fetchImpl) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetchImpl(EASA_URL, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const parsed = parseEasa(await res.text());
    if (!parsed) throw new Error('tableau des FIR introuvable');
    cache = { ...cache, firs: parsed.firs, easaDate: parsed.date, easaStatus: 'ok' };
    return true;
  } catch (err) {
    console.warn('[gnss] EASA :', err.message);
    cache = { ...cache, easaStatus: cache.firs.length ? 'stale' : 'error' };
    return false;
  } finally { clearTimeout(t); }
}

async function fetchGnss(fetchImpl = defaultFetch, now = new Date()) {
  if (isFetching) return cache;
  isFetching = true;
  try {
    let ok = false;
    try {
      await fetchStanford(fetchImpl, now);
      ok = !!cache.day;
    } catch (err) { console.warn('[gnss] Stanford :', err.message); }
    await fetchEasa(fetchImpl);
    cache = { ...cache, lastUpdate: ok ? new Date().toISOString() : cache.lastUpdate, status: ok ? 'ok' : (cache.cells.length ? 'stale' : 'error') };
    saveToDisk();
    const jam = cache.events.filter(e => e.kind === 'jam').length;
    console.log(`[gnss] ${cache.day || '—'} : ${cache.cells.length} hexagones (forts ${cache.cells.filter(c => c.level === 'fort').length}), `
      + `${jam} sources de brouillage, ${cache.events.length - jam} leurrages (${cache.spoofDay || '—'}) · EASA ${cache.firs.length} FIR (${cache.easaDate || '—'})`);
  } finally { isFetching = false; }
  return cache;
}

function getCache() { return cache; }

module.exports = {
  fetchGnss, getCache, regionOf,
  _reduceHeatmap: reduceHeatmap, _reduceEvents: reduceEvents, _parseEasa: parseEasa, _candidateDays: candidateDays,
  _reset: () => { cache = { day: null, spoofDay: null, cells: [], events: [], firs: [], easaDate: null, lastUpdate: null, status: 'initializing', easaStatus: 'initializing' }; },
};
