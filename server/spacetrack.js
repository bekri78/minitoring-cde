'use strict';

const LOGIN_URL = 'https://www.space-track.org/ajaxauth/login';
const BASE_URL  = 'https://www.space-track.org/basicspacedata/query';

// ── Coordonnées approximatives par code pays Space-Track ─────────────────────
// Utilisées pour placer les objets sur la carte (pays de lancement, pas le point de rentrée)
const COUNTRY_COORDS = {
  'US':    [-95.71,  37.09],
  'CIS':   [105.32,  61.52],   // Russie (centroïde)
  'PRC':   [104.19,  35.86],   // Chine
  'FR':    [  2.21,  46.23],
  'UK':    [ -3.44,  55.38],
  'JPN':   [138.25,  36.20],
  'IND':   [ 78.96,  20.59],
  'ESA':   [  2.21,  46.23],   // ESA (siège France)
  'AUS':   [133.78, -25.27],
  'CA':    [-106.35,  56.13],
  'GER':   [ 10.45,  51.16],
  'IT':    [ 12.57,  41.87],
  'SPN':   [ -3.75,  40.46],
  'ISR':   [ 34.85,  31.05],
  'UAE':   [ 53.85,  23.42],
  'NZ':    [174.88, -40.90],
  'BRAZ':  [-51.93, -14.24],
  'TUR':   [ 35.24,  38.96],
  'SWE':   [ 18.64,  60.13],
  'NOR':   [  8.47,  60.47],
  'NETH':  [  5.29,  52.13],
  'ARGN':  [-63.62, -38.42],
  'KOR':   [127.77,  35.91],
  'NKOR':  [127.51,  40.34],
  'IRAN':  [ 53.69,  32.43],
  'PAKI':  [ 69.34,  30.38],
  'THAI':  [100.99,  15.87],
  'INDO':  [113.92,  -0.79],
  'SAFR':  [ 24.68, -28.47],
  'EGYP':  [ 30.80,  26.82],
  'SING':  [103.82,   1.35],
  'TWN':   [120.96,  23.70],
  'MEX':   [-102.55, 23.63],
  'POL':   [ 19.15,  51.92],
  'NATO':  [  4.35,  50.80],
};

// ── État en mémoire ───────────────────────────────────────────────────────────
let sessionCookie = null;

let cache = {
  objects:    [],   // objets normalisés
  lastUpdate: null,
};

let isFetching = false;

// ── Authentification ──────────────────────────────────────────────────────────
async function login() {
  const user = process.env.SPACETRACK_USER;
  const pass = process.env.SPACETRACK_PASS;

  if (!user || !pass) {
    console.warn('[spacetrack] SPACETRACK_USER / SPACETRACK_PASS non définis — module désactivé');
    return false;
  }

  console.log('[spacetrack] login...');
  const resp = await fetch(LOGIN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `identity=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`,
  });

  if (!resp.ok) {
    console.error(`[spacetrack] login HTTP ${resp.status}`);
    return false;
  }

  // Extraire tous les cookies Set-Cookie et les concaténer
  let raw = [];
  if (typeof resp.headers.getSetCookie === 'function') {
    raw = resp.headers.getSetCookie();
  } else {
    const combined = resp.headers.get('set-cookie');
    if (combined) raw = combined.split(/,(?=[^ ])/);
  }

  if (!raw.length) {
    console.error('[spacetrack] aucun cookie reçu après login');
    return false;
  }

  // Ne garder que la partie name=value (ignorer les attributs Path/HttpOnly etc.)
  sessionCookie = raw.map(c => c.split(';')[0].trim()).join('; ');
  console.log('[spacetrack] login ok');
  return true;
}

// ── Fetch DECAY ───────────────────────────────────────────────────────────────
async function fetchDecay() {
  if (isFetching) {
    console.log('[spacetrack] already fetching — skipped');
    return;
  }
  isFetching = true;

  const user = process.env.SPACETRACK_USER;
  const pass = process.env.SPACETRACK_PASS;
  if (!user || !pass) {
    isFetching = false;
    return;
  }

  try {
    // Login si pas de session active
    if (!sessionCookie) {
      const ok = await login();
      if (!ok) { isFetching = false; return; }
    }

    // Fenêtre : rentrées prévues dans les 30 prochains jours
    const now    = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const nowStr    = now.toISOString().slice(0, 10);
    const futureStr = future.toISOString().slice(0, 10);

    const url = `${BASE_URL}/class/decay/DECAY_EPOCH/%3E${nowStr}/DECAY_EPOCH/%3C${futureStr}/orderby/DECAY_EPOCH%20asc/limit/100/format/json`;

    console.log('[spacetrack] fetching DECAY...');
    let resp = await fetch(url, { headers: { Cookie: sessionCookie } });

    // Session expirée → re-login
    if (resp.status === 401 || resp.status === 403) {
      console.log('[spacetrack] session expirée — re-login');
      sessionCookie = null;
      const ok = await login();
      if (!ok) { isFetching = false; return; }
      resp = await fetch(url, { headers: { Cookie: sessionCookie } });
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const rows = Array.isArray(data) ? data : [];

    cache.objects    = rows.map(normalizeDecay).filter(Boolean);
    cache.lastUpdate = new Date().toISOString();

    console.log(`[spacetrack] ok — ${cache.objects.length} objets DECAY`);
  } catch (err) {
    console.error('[spacetrack] fetchDecay failed:', err.message);
  } finally {
    isFetching = false;
  }
}

// ── Normalisation ─────────────────────────────────────────────────────────────
function normalizeDecay(row) {
  const country = row.COUNTRY_CODE || 'INTL';
  const coords  = COUNTRY_COORDS[country];
  if (!coords) return null;   // pays inconnu → on ne place pas sur la carte

  const decayEpoch = row.DECAY_EPOCH || null;

  // Ignorer les rentrées déjà confirmées (> 6h dans le passé)
  if (decayEpoch && new Date(decayEpoch).getTime() < Date.now() - 6 * 3600 * 1000) {
    return null;
  }

  const daysLeft   = decayEpoch
    ? Math.max(0, (new Date(decayEpoch).getTime() - Date.now()) / 86_400_000)
    : null;

  // Couleur selon urgence
  let color = '#ffdd55';
  if (daysLeft !== null) {
    if (daysLeft < 3)  color = '#ff2244';
    else if (daysLeft < 7)  color = '#ff6600';
    else if (daysLeft < 14) color = '#ffaa00';
  }

  return {
    id:          row.NORAD_CAT_ID   || 'unknown',
    name:        row.OBJECT_NAME    || `NORAD ${row.NORAD_CAT_ID}`,
    objectId:    row.OBJECT_ID      || '',       // désignateur international
    decayEpoch,
    window:      Number(row.WINDOW) || 0,        // incertitude en heures
    inclination: Number(row.INCLINATION) || 0,
    apogee:      Number(row.APOGEE)  || 0,       // km
    perigee:     Number(row.PERIGEE) || 0,       // km
    country,
    msgEpoch:    row.MSG_EPOCH      || null,
    daysLeft,
    color,
    // Coordonnées du pays de lancement + jitter pour éviter les superpositions
    lon: coords[0] + (Math.random() - 0.5) * 8,
    lat: coords[1] + (Math.random() - 0.5) * 8,
  };
}

function getCache() { return cache; }

// ── Cache TIP ─────────────────────────────────────────────────────────────────
let tipCache = {
  objects:    [],
  lastUpdate: null,
};

let isFetchingTip = false;

// ── Fetch TIP ─────────────────────────────────────────────────────────────────
async function fetchTip() {
  if (isFetchingTip) {
    console.log('[spacetrack-tip] already fetching — skipped');
    return;
  }
  isFetchingTip = true;

  const user = process.env.SPACETRACK_USER;
  const pass = process.env.SPACETRACK_PASS;
  if (!user || !pass) {
    isFetchingTip = false;
    return;
  }

  try {
    if (!sessionCookie) {
      const ok = await login();
      if (!ok) { isFetchingTip = false; return; }
    }

    // Fenêtre : TIP dans les 30 prochains jours
    const now    = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const nowStr    = now.toISOString().slice(0, 10);
    const futureStr = future.toISOString().slice(0, 10);

    const url = `${BASE_URL}/class/tip/DECAY_EPOCH/%3E${nowStr}/DECAY_EPOCH/%3C${futureStr}/orderby/DECAY_EPOCH%20asc/limit/100/format/json`;

    console.log('[spacetrack-tip] fetching TIP...');
    let resp = await fetch(url, { headers: { Cookie: sessionCookie } });

    if (resp.status === 401 || resp.status === 403) {
      console.log('[spacetrack-tip] session expirée — re-login');
      sessionCookie = null;
      const ok = await login();
      if (!ok) { isFetchingTip = false; return; }
      resp = await fetch(url, { headers: { Cookie: sessionCookie } });
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const rows = Array.isArray(data) ? data : [];

    tipCache.objects    = rows.map(normalizeTip).filter(Boolean);
    tipCache.lastUpdate = new Date().toISOString();

    console.log(`[spacetrack-tip] ok — ${tipCache.objects.length} objets TIP`);
  } catch (err) {
    console.error('[spacetrack-tip] fetchTip failed:', err.message);
  } finally {
    isFetchingTip = false;
  }
}

// ── Normalisation TIP ─────────────────────────────────────────────────────────
function normalizeTip(row) {
  const lat = Number(row.LAT);
  const lon = Number(row.LON);
  // TIP a de vraies coordonnées orbitales — ignorer si invalides
  if (isNaN(lat) || isNaN(lon)) return null;

  const decayEpoch = row.DECAY_EPOCH || null;

  // Ignorer les prédictions déjà passées (> 6h dans le passé)
  if (decayEpoch && new Date(decayEpoch).getTime() < Date.now() - 6 * 3600 * 1000) {
    return null;
  }

  const hoursLeft  = decayEpoch
    ? (new Date(decayEpoch).getTime() - Date.now()) / 3_600_000
    : null;

  let color = '#ffdd55';
  if (hoursLeft !== null) {
    if (hoursLeft < 6)       color = '#ff2244';
    else if (hoursLeft < 24) color = '#ff6600';
    else if (hoursLeft < 72) color = '#ffaa00';
  }

  return {
    id:          row.NORAD_CAT_ID  || 'unknown',
    name:        row.OBJECT_NAME   || `NORAD ${row.NORAD_CAT_ID}`,
    objectId:    row.OBJECT_ID     || '',
    objectType:  row.OBJECT_TYPE   || '',
    decayEpoch,
    window:      Number(row.WINDOW) || 0,    // incertitude en minutes
    inclination: Number(row.INCLINATION) || 0,
    direction:   row.DIRECTION     || '',
    country:     row.COUNTRY_CODE  || 'INTL',
    highInterest: row.HIGH_INTEREST === 'Y',
    msgEpoch:    row.MSG_EPOCH     || null,
    hoursLeft,
    color,
    lat,
    lon,
  };
}

function getTipCache() { return tipCache; }

module.exports = { fetchDecay, getCache, fetchTip, getTipCache };
