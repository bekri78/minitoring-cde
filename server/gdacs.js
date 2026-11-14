'use strict';
/**
 * gdacs.js — Alertes catastrophes GDACS (ONU / Commission européenne).
 *
 * Séismes, cyclones, inondations, volcans, sécheresses et feux de forêt, avec
 * un niveau d'alerte vert / orange / rouge calculé par GDACS (impact humain).
 * API publique, sans clé : https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH
 *
 * Tri : orange et rouge pour tous les types ; vert seulement pour cyclones,
 * inondations, volcans, sécheresses et feux (les petits séismes sont déjà
 * couverts par la couche USGS). Fenêtre de 10 jours, 150 événements au plus.
 */

const fs   = require('fs');
const path = require('path');

const API           = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
const CACHE_DIR     = process.env.CACHE_DIR || '/data';
const CACHE_FILE    = path.join(CACHE_DIR, 'gdacs.json');
const CACHE_MAX_AGE = 60 * 60 * 1000;
const WINDOW_DAYS   = 10;
const MAX_EVENTS    = 150;
const TYPES         = ['EQ', 'TC', 'FL', 'VO', 'DR', 'WF'];
const TYPE_FR       = { EQ: 'Séisme', TC: 'Cyclone', FL: 'Inondation', VO: 'Volcan', DR: 'Sécheresse', WF: 'Feu de forêt' };
const LEVEL_RANK    = { red: 3, orange: 2, green: 1 };

let cache = { events: [], lastUpdate: null, status: 'initializing' };
let isFetching = false;

const day = d => d.toISOString().slice(0, 10);
const lower = v => String(v || '').trim().toLowerCase();

function normalize(f) {
  const p = (f && f.properties) || {};
  const c = (f && f.geometry && Array.isArray(f.geometry.coordinates)) ? f.geometry.coordinates : null;
  const type = String(p.eventtype || '').toUpperCase();
  const level = lower(p.alertlevel || p.episodealertlevel);
  const lat = c ? Number(c[1]) : NaN, lon = c ? Number(c[0]) : NaN;
  if (!TYPES.includes(type) || !LEVEL_RANK[level] || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const sev = p.severitydata || {};
  const url = (p.url && (p.url.report || p.url.details)) || (p.eventid ? `https://www.gdacs.org/report.aspx?eventtype=${type}&eventid=${p.eventid}` : '');
  return {
    id:        `gdacs-${type}-${p.eventid}`,
    type,
    typeFr:    TYPE_FR[type],
    level,                                   // green | orange | red
    name:      String(p.name || p.eventname || TYPE_FR[type]).slice(0, 160),
    country:   String(p.country || '').slice(0, 120),
    iso3:      p.iso3 || '',
    severity:  String(sev.severitytext || p.description || '').slice(0, 200),
    alertScore: Number(p.alertscore ?? p.episodealertscore) || null,
    from:      p.fromdate ? new Date(p.fromdate + (/[zZ]|[+-]\d\d:?\d\d$/.test(p.fromdate) ? '' : 'Z')).toISOString() : null,
    to:        p.todate ? new Date(p.todate + (/[zZ]|[+-]\d\d:?\d\d$/.test(p.todate) ? '' : 'Z')).toISOString() : null,
    current:   p.iscurrent === undefined ? true : String(p.iscurrent) === 'true' || p.iscurrent === true,
    lat:       Math.round(lat * 1000) / 1000,
    lon:       Math.round(lon * 1000) / 1000,
    url,
  };
}

// Garde l'essentiel : orange/rouge partout, vert hors séismes ; plus grave et plus récent d'abord
function select(features) {
  const byId = new Map();
  for (const f of features || []) {
    const e = normalize(f);
    if (!e) continue;
    if (e.level === 'green' && e.type === 'EQ') continue;
    const prev = byId.get(e.id);
    if (!prev || LEVEL_RANK[e.level] > LEVEL_RANK[prev.level] || (e.to || '') > (prev.to || '')) byId.set(e.id, e);
  }
  return [...byId.values()]
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || String(b.to || b.from).localeCompare(String(a.to || a.from)))
    .slice(0, MAX_EVENTS);
}

function saveToDisk() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); }
  catch (err) { console.warn('[gdacs] save failed:', err.message); }
}
function loadFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw && raw.lastUpdate && Array.isArray(raw.events)) return raw;
  } catch (_) {}
  return null;
}
const restored = loadFromDisk();
if (restored) cache = { ...restored, status: 'cached' };

async function fetchGdacs(fetchImpl = fetch) {
  if (isFetching) return cache;
  isFetching = true;
  try {
    const to = new Date(), from = new Date(Date.now() - WINDOW_DAYS * 86400000);
    const url = `${API}?eventlist=${TYPES.join(';')}&alertlevel=Green;Orange;Red&fromDate=${day(from)}&toDate=${day(to)}&pageSize=300`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try { res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'OGMA/1.0 (veille OSINT)' }, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const events = select(json.features || []);
    cache = { events, lastUpdate: new Date().toISOString(), status: 'ok' };
    saveToDisk();
    const n = l => events.filter(e => e.level === l).length;
    console.log(`[gdacs] ${events.length} alertes (rouge ${n('red')}, orange ${n('orange')}, vert ${n('green')})`);
  } catch (err) {
    console.warn('[gdacs] fetch failed:', err.message);
    cache = { ...cache, status: cache.events.length ? 'stale' : 'error' };
  } finally {
    isFetching = false;
  }
  return cache;
}

function getCache() { return cache; }
function isStale() { return !cache.lastUpdate || Date.now() - Date.parse(cache.lastUpdate) > CACHE_MAX_AGE; }

module.exports = { fetchGdacs, getCache, isStale, _normalize: normalize, _select: select };
