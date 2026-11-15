'use strict';
/**
 * copernicus.js — Activations de cartographie d'urgence Copernicus EMS (Rapid Mapping, UE).
 *
 * Une activation signifie qu'un État ou une organisation a demandé à l'Union européenne
 * de cartographier une catastrophe en urgence : c'est un indicateur de gravité.
 * API publique, sans clé : rapidmapping.emergency.copernicus.eu/backend/dashboard-api/
 * Données libres de réutilisation, mention « © Union européenne, Copernicus EMS ».
 *
 * On garde les activations encore ouvertes ou lancées depuis moins de 30 jours.
 * Le champ gdacsId (ex. « EQ1570339 ») donne l'alerte GDACS correspondante
 * (identifiant OGMA « gdacs-EQ-1570339 ») : le front affiche alors un badge dans la fiche.
 */

const fs   = require('fs');
const path = require('path');

const API        = 'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/';
const VIEWER     = 'https://rapidmapping.emergency.copernicus.eu/';
const CACHE_DIR  = process.env.CACHE_DIR || '/data';
const CACHE_FILE = path.join(CACHE_DIR, 'copernicus.json');
const RECENT_DAYS = 30;
const PAGE = 60;

// Catégories Copernicus → types GDACS utilisés par les pictogrammes du calque Crises
const CATEGORY_TYPE = { Flood: 'FL', Earthquake: 'EQ', Wildfire: 'WF', Storm: 'TC', 'Volcanic activity': 'VO', Drought: 'DR' };
const CATEGORY_FR = { Flood: 'Inondation', Earthquake: 'Séisme', Wildfire: 'Feu de forêt', Storm: 'Tempête',
  'Volcanic activity': 'Volcan', Drought: 'Sécheresse', Landslide: 'Glissement de terrain', 'Industrial accident': 'Accident industriel',
  'Humanitarian': 'Crise humanitaire', 'Mass movement': 'Mouvement de terrain', Other: 'Autre' };

let cache = { activations: [], lastUpdate: null, status: 'initializing' };
let isFetching = false;

// « POINT (lon lat) » → [lat, lon]
function parsePoint(wkt) {
  const m = String(wkt || '').match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
  return m ? [Number(m[2]), Number(m[1])] : null;
}

// « EQ1570339 » → « gdacs-EQ-1570339 » (identifiant des alertes GDACS d'OGMA)
function gdacsRef(id) {
  const m = String(id || '').trim().toUpperCase().match(/^([A-Z]{2})\s*-?\s*(\d+)$/);
  return m ? `gdacs-${m[1]}-${m[2]}` : null;
}

const utc = s => (s ? new Date(String(s) + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')).toISOString() : null);

function normalize(a) {
  if (!a || !a.code) return null;
  const pt = parsePoint(a.centroid);
  return {
    id: 'cems-' + a.code,
    code: String(a.code),
    name: String(a.name || a.code).slice(0, 160),
    category: a.category || '',
    categoryFr: CATEGORY_FR[a.category] || a.category || '',
    type: CATEGORY_TYPE[a.category] || null,
    countries: Array.isArray(a.countries) ? a.countries.slice(0, 5) : [],
    lat: pt ? Math.round(pt[0] * 1000) / 1000 : null,
    lon: pt ? Math.round(pt[1] * 1000) / 1000 : null,
    eventTime: utc(a.eventTime),
    activationTime: utc(a.activationTime),
    closed: a.closed === true,
    gdacsRef: gdacsRef(a.gdacsId),
    products: Number(a.n_products) || 0,
    url: VIEWER + encodeURIComponent(a.code),
  };
}

function select(items, now = Date.now()) {
  const limit = now - RECENT_DAYS * 86400000;
  return (items || []).map(normalize).filter(a => a && (!a.closed || (a.activationTime && Date.parse(a.activationTime) >= limit)))
    .sort((x, y) => String(y.activationTime || '').localeCompare(String(x.activationTime || '')));
}

function saveToDisk() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); }
  catch (err) { console.warn('[copernicus] save failed:', err.message); }
}
try {
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  if (raw && raw.lastUpdate && Array.isArray(raw.activations)) cache = { ...raw, status: 'cached' };
} catch (_) {}

async function fetchCopernicus(fetchImpl = fetch, now = Date.now()) {
  if (isFetching) return cache;
  isFetching = true;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetchImpl(`${API}?limit=${PAGE}`, { headers: { 'User-Agent': 'OGMA/1.0 (veille OSINT)', Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const activations = select(Array.isArray(j) ? j : j.results, now);
    cache = { activations, lastUpdate: new Date().toISOString(), status: 'ok' };
    saveToDisk();
    console.log(`[copernicus] ${activations.length} activations (${activations.filter(a => !a.closed).length} ouvertes, ${activations.filter(a => a.gdacsRef).length} liées à GDACS)`);
  } catch (err) {
    console.warn('[copernicus] fetch failed:', err.message);
    cache = { ...cache, status: cache.activations.length ? 'stale' : 'error' };
  } finally { clearTimeout(t); isFetching = false; }
  return cache;
}

function getCache() { return cache; }

module.exports = { fetchCopernicus, getCache, _normalize: normalize, _select: select, _gdacsRef: gdacsRef, _parsePoint: parsePoint };
