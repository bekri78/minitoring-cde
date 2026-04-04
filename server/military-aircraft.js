'use strict';

// ── Sources ───────────────────────────────────────────────────────────────
// OpenSky bloque les IP des clouds (Railway/GCP/AWS) — fallback sur ADS-B Exchange
const OPENSKY_URL   = 'https://opensky-network.org/api/states/all';
const ADSBX_URL     = 'https://adsbexchange-com1.p.rapidapi.com/v2/mil/';  // militaires uniquement
const CACHE_MAX_AGE = 5 * 60 * 1000;   // 5min
const TRAIL_MAX_PTS = 6;
const TRAIL_EXPIRE  = 40 * 60 * 1000;

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
async function fetchFromOpenSky() {
  const user = process.env.OPENSKY_USER;
  const pass = process.env.OPENSKY_PASS;
  const headers = user && pass
    ? { 'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') }
    : {};

  const resp = await fetch(OPENSKY_URL, {
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (resp.status === 429) throw new Error('OpenSky rate limited (429)');
  if (!resp.ok) throw new Error(`OpenSky HTTP ${resp.status}`);

  const data   = await resp.json();
  const states = data.states || [];
  const aircraft = [];

  for (const s of states) {
    if (!s || s[8]) continue;              // on_ground
    if (s[5] == null || s[6] == null) continue;

    const icao24   = (s[0] || '').toLowerCase();
    const callsign = (s[1] || '').trim();
    const mil      = detectMilitary(icao24, callsign);
    if (!mil) continue;

    const lon   = Number(s[5]);
    const lat   = Number(s[6]);
    const alt   = s[7]  != null ? Math.round(Number(s[7]))         : null; // mètres
    const speed = s[9]  != null ? Math.round(Number(s[9]) * 1.944) : null; // m/s → kt
    const track = s[10] != null ? Number(s[10]) : 0;

    updateTrail(icao24, lon, lat);
    const trail = trails.get(icao24)?.positions || [];

    aircraft.push({
      id: icao24, callsign: callsign || icao24.toUpperCase(),
      country: mil.country, color: mil.color,
      lon, lat, alt, altFt: alt != null ? Math.round(alt * 3.281) : null,
      speed, track,
      trail: trail.map(p => [p.lon, p.lat]),
    });
  }
  console.log(`[military-aircraft] OpenSky ok — ${aircraft.length} aircraft from ${states.length} states`);
  return aircraft;
}

// ── Fetch ADS-B Exchange /v2/mil/ (militaires uniquement) ─────────────────
async function fetchFromAdsbExchange() {
  const key = process.env.ADSBX_API_KEY;
  if (!key) throw new Error('ADSBX_API_KEY not set');

  const resp = await fetch(ADSBX_URL, {
    headers: {
      'X-RapidAPI-Key':  key,
      'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (resp.status === 429) throw new Error('ADS-B Exchange rate limited (429)');
  if (!resp.ok) throw new Error(`ADS-B Exchange HTTP ${resp.status}`);

  const data = await resp.json();
  const ac   = data.ac || [];
  const aircraft = [];

  for (const a of ac) {
    if (!a || a.alt_baro === 'ground') continue;
    if (a.lat == null || a.lon == null) continue;

    const icao24   = (a.hex || '').toLowerCase();
    const callsign = (a.flight || '').trim();
    const mil      = detectMilitary(icao24, callsign) || { country: 'MIL', color: '#e8f4ff' };

    const lon   = Number(a.lon);
    const lat   = Number(a.lat);
    const altFt = a.alt_baro != null && a.alt_baro !== 'ground' ? Math.round(Number(a.alt_baro)) : null;
    const alt   = altFt != null ? Math.round(altFt / 3.281) : null;
    const speed = a.gs    != null ? Math.round(Number(a.gs))    : null; // déjà en kt
    const track = a.track != null ? Number(a.track) : 0;

    updateTrail(icao24, lon, lat);
    const trail = trails.get(icao24)?.positions || [];

    aircraft.push({
      id: icao24, callsign: callsign || icao24.toUpperCase(),
      country: mil.country, color: mil.color,
      lon, lat, alt, altFt, speed, track,
      trail: trail.map(p => [p.lon, p.lat]),
    });
  }
  console.log(`[military-aircraft] ADS-B Exchange ok — ${aircraft.length} aircraft`);
  return aircraft;
}

// ── Fetch principal : ADS-B Exchange si clé dispo, sinon OpenSky ──────────
async function fetchMilitary() {
  if (isFetching) return;

  if (cache.lastUpdate) {
    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age < CACHE_MAX_AGE) return;
  }

  isFetching = true;
  purgeTrails();

  try {
    let aircraft;

    // Priorité 1 : ADS-B Exchange (fonctionne depuis les clouds)
    if (process.env.ADSBX_API_KEY) {
      try {
        aircraft = await fetchFromAdsbExchange();
      } catch (err) {
        console.warn(`[military-aircraft] ADS-B Exchange failed: ${err.message} — trying OpenSky fallback`);
        aircraft = await fetchFromOpenSky();
      }
    } else {
      // Priorité 2 : OpenSky (peut être bloqué sur cloud)
      aircraft = await fetchFromOpenSky();
    }

    cache.aircraft   = aircraft;
    cache.count      = aircraft.length;
    cache.lastUpdate = new Date().toISOString();
  } catch (err) {
    console.error(`[military-aircraft] fetch failed: ${err.message} (cause: ${err.cause?.message || err.cause || 'unknown'})`);
  } finally {
    isFetching = false;
  }
}

function getCache() { return cache; }

module.exports = { fetchMilitary, getCache };
