'use strict';

// ── Sources ───────────────────────────────────────────────────────────────
// Plusieurs sources communautaires gratuites, sans clé, testées cloud-friendly
// Ordre de priorité : airplanes.live > adsb.fi > OpenSky (souvent bloqué datacenter)
const SOURCES = [
  { name: 'airplanes.live', url: 'https://api.airplanes.live/v2/mil' },
  { name: 'adsb.fi',        url: 'https://api.adsb.fi/v1/mil'        },
  { name: 'opensky',        url: 'https://opensky-network.org/api/states/all' },
];
const CACHE_MAX_AGE  = 5  * 60 * 1000;
const TRAIL_MAX_PTS  = 6;
const TRAIL_EXPIRE   = 40 * 60 * 1000;
// Backoff : si toutes les sources échouent, on ne retente qu'après 30min
let   allFailedUntil = 0;

// ── Plages ICAO hex des aviations militaires connues ─────────────────────
// Source : ICAO Doc 9303 + bases publiques (OpenSkyDB, ADSB-DB)
const MIL_HEX_RANGES = [
  // USA Military (USAF / USN / USMC / Army)
  { lo: 0xADF7C8, hi: 0xAFFFFF, country: 'USA',    color: '#4a9eff' },
  { lo: 0xA00000, hi: 0xA0FFFF, country: 'USA',    color: '#4a9eff' },
  // UK Military (RAF / RN / AAC)
  { lo: 0x43C000, hi: 0x43FFFF, country: 'GBR',    color: '#60ddff' },
  // France (Armée de l'air et de l'espace / Marine)
  { lo: 0x3B7000, hi: 0x3B9FFF, country: 'FRA',    color: '#5588ff' },
  // Germany (Luftwaffe / Heer)
  { lo: 0x3C4000, hi: 0x3C5FFF, country: 'DEU',    color: '#aaddff' },
  // Canada (RCAF)
  { lo: 0xC03100, hi: 0xC03FFF, country: 'CAN',    color: '#88ddff' },
  // Australia (RAAF)
  { lo: 0x7C4200, hi: 0x7C42FF, country: 'AUS',    color: '#66ccff' },
  // Italy (AMI)
  { lo: 0x3D0000, hi: 0x3D1FFF, country: 'ITA',    color: '#99bbff' },
  // Spain (Ejército del Aire)
  { lo: 0x34B000, hi: 0x34BFFF, country: 'ESP',    color: '#aabbff' },
  // Netherlands (KLu)
  { lo: 0x480000, hi: 0x480FFF, country: 'NLD',    color: '#88ccff' },
  // Poland (Siły Powietrzne)
  { lo: 0x489000, hi: 0x489FFF, country: 'POL',    color: '#8899ff' },
  // Russia (VKS / VMF)
  { lo: 0x1A0000, hi: 0x1AFFFF, country: 'RUS',    color: '#ff5555' },
  { lo: 0x100000, hi: 0x1FFFFF, country: 'RUS',    color: '#ff5555' },
  // China (PLAAF / PLAN)
  { lo: 0x780000, hi: 0x7BFFFF, country: 'CHN',    color: '#ff6644' },
  // Israel (IAF)
  { lo: 0x738000, hi: 0x738FFF, country: 'ISR',    color: '#ffcc55' },
  // Turkey (THK)
  { lo: 0x4B8000, hi: 0x4B8FFF, country: 'TUR',    color: '#ffaa44' },
  // Japan (JASDF / JMSDF)
  { lo: 0x840000, hi: 0x85FFFF, country: 'JPN',    color: '#ff9966' },
  // South Korea (ROKAF)
  { lo: 0x71C000, hi: 0x71CFFF, country: 'KOR',    color: '#ffbb55' },
  // NATO AWACS / NATO special
  { lo: 0x456000, hi: 0x456FFF, country: 'NATO',   color: '#00ffcc' },
];

// Callsigns militaires OTAN/US connus (backup si hex hors plage)
const MIL_CALLSIGN_RE = /^(RCH|SAM|REACH|DUKE|MAGMA|COBRA|VIPER|HAWK|NATO|BAF|GAF|IAF|NAVY|USAF|CNV|TOPGUN|JOLLY|SPAR|EVAC|JAKE|SWIFT|KING|VALOR|BOXER|ATLAS|BLADE|BONE|GHOST|LANCER|FURY|RAVEN|IRON|STEEL|BRONZE|SILVER|GOLD|EAGLE|FALCON|THUNDER|STORM|WOLF|BEAR|TIGER|SHARK|LION)\d*/i;

// ── Trail en mémoire ──────────────────────────────────────────────────────
// icao24 → { positions: [{lon,lat,ts}], lastSeen: ms }
const trails = new Map();

function updateTrail(icao24, lon, lat) {
  const entry = trails.get(icao24) || { positions: [], lastSeen: 0 };
  entry.positions.push({ lon, lat, ts: Date.now() });
  if (entry.positions.length > TRAIL_MAX_PTS) entry.positions.shift();
  entry.lastSeen = Date.now();
  trails.set(icao24, entry);
}

function purgeTrails() {
  const cutoff = Date.now() - TRAIL_EXPIRE;
  for (const [id, entry] of trails) {
    if (entry.lastSeen < cutoff) trails.delete(id);
  }
}

// ── Détection militaire ───────────────────────────────────────────────────
function detectMilitary(icao24hex, callsign) {
  const hex = parseInt(icao24hex, 16);
  for (const range of MIL_HEX_RANGES) {
    if (hex >= range.lo && hex <= range.hi) {
      return { country: range.country, color: range.color };
    }
  }
  // Fallback callsign
  if (callsign && MIL_CALLSIGN_RE.test(callsign.trim())) {
    return { country: 'UNKNOWN', color: '#e8f4ff' };
  }
  return null;
}

// ── Cache ─────────────────────────────────────────────────────────────────
let cache = {
  aircraft:   [],
  count:      0,
  lastUpdate: null,
};
let isFetching = false;

// ── Fetch OpenSky ─────────────────────────────────────────────────────────
// ── Fetch depuis une source /mil compatible (airplanes.live / adsb.fi) ───
// Format commun : { ac: [{ hex, flight, lat, lon, alt_baro, gs, track }] }
async function fetchFromAcSource(name, url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'WorldMonitor/1.0' },
    signal:  AbortSignal.timeout(12000),
  });
  if (resp.status === 429) throw new Error(`${name} rate limited (429)`);
  if (!resp.ok) throw new Error(`${name} HTTP ${resp.status}`);

  const data = await resp.json();
  const ac   = data.ac || data.states || [];  // compat OpenSky states[]
  const aircraft = [];

  for (const a of ac) {
    if (!a) continue;

    // ── Format OpenSky (tableau indexé) ──────────────────────────────────
    if (Array.isArray(a)) {
      if (!a[5] || !a[6] || a[8]) continue; // pas de pos ou au sol
      const icao24   = (a[0] || '').toLowerCase();
      const callsign = (a[1] || '').trim();
      const mil = detectMilitary(icao24, callsign);
      if (!mil) continue;
      const lon = Number(a[5]), lat = Number(a[6]);
      const alt = a[7] != null ? Math.round(Number(a[7])) : null;
      const speed = a[9]  != null ? Math.round(Number(a[9]) * 1.944) : null;
      const track = a[10] != null ? Number(a[10]) : 0;
      updateTrail(icao24, lon, lat);
      aircraft.push({ id: icao24, callsign: callsign || icao24.toUpperCase(),
        country: mil.country, color: mil.color, lon, lat, alt,
        altFt: alt != null ? Math.round(alt * 3.281) : null,
        speed, track, trail: (trails.get(icao24)?.positions || []).map(p => [p.lon, p.lat]) });
      continue;
    }

    // ── Format airplanes.live / adsb.fi (objet) ──────────────────────────
    if (a.lat == null || a.lon == null) continue;
    if (a.alt_baro === 'ground') continue;

    const icao24   = (a.hex || '').toLowerCase().replace(/^~/, '');
    const callsign = (a.flight || a.r || '').trim();
    const mil      = detectMilitary(icao24, callsign) || { country: 'MIL', color: '#e8f4ff' };

    const lon   = Number(a.lon);
    const lat   = Number(a.lat);
    const altFt = a.alt_baro != null && a.alt_baro !== 'ground' ? Math.round(Number(a.alt_baro)) : null;
    const alt   = altFt != null ? Math.round(altFt / 3.281) : null;
    const speed = a.gs    != null ? Math.round(Number(a.gs))    : null;
    const track = a.track != null ? Number(a.track) : 0;

    updateTrail(icao24, lon, lat);
    aircraft.push({ id: icao24, callsign: callsign || icao24.toUpperCase(),
      country: mil.country, color: mil.color, lon, lat, alt, altFt, speed, track,
      trail: (trails.get(icao24)?.positions || []).map(p => [p.lon, p.lat]) });
  }

  console.log(`[military-aircraft] ${name} ok — ${aircraft.length} aircraft`);
  return aircraft;
}

// ── Fetch principal : boucle sur SOURCES avec backoff 30min si tout échoue ─
async function fetchMilitary() {
  if (isFetching) return;

  if (cache.lastUpdate) {
    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age < CACHE_MAX_AGE) return;
  }

  // Backoff global : toutes les sources ont récemment échoué
  if (allFailedUntil > Date.now()) {
    const min = Math.ceil((allFailedUntil - Date.now()) / 60000);
    console.log(`[military-aircraft] all sources unavailable — retry in ${min}min`);
    return;
  }

  isFetching = true;
  purgeTrails();

  try {
    let aircraft = null;

    for (const src of SOURCES) {
      // Pour OpenSky, injecter Basic Auth dans l'URL si dispo
      let url = src.url;
      if (src.name === 'opensky') {
        const user = process.env.OPENSKY_USER;
        const pass = process.env.OPENSKY_PASS;
        if (user && pass) {
          const u = new URL(url);
          u.username = user;
          u.password = pass;
          url = u.toString();
        }
      }

      try {
        aircraft = await fetchFromAcSource(src.name, url);
        break; // succès → on arrête la boucle
      } catch (err) {
        console.warn(`[military-aircraft] ${src.name} failed: ${err.message}`);
      }
    }

    if (aircraft === null) {
      // Toutes les sources ont échoué → backoff 30min
      allFailedUntil = Date.now() + 30 * 60 * 1000;
      console.error('[military-aircraft] all sources failed — backoff 30min');
      return;
    }

    cache.aircraft   = aircraft;
    cache.count      = aircraft.length;
    cache.lastUpdate = new Date().toISOString();
  } finally {
    isFetching = false;
  }
}

function getCache() { return cache; }

module.exports = { fetchMilitary, getCache };
