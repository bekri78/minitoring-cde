'use strict';

// ── Sources globales /mil (retournent uniquement les militaires) ──────────
const MIL_SOURCES = [
  { name: 'airplanes.live', url: 'https://api.airplanes.live/v2/mil' },
];


const CACHE_MAX_AGE = 5  * 60 * 1000;
const TRAIL_MAX_PTS = 6;
const TRAIL_EXPIRE  = 40 * 60 * 1000;

// ── Plages ICAO hex des aviations militaires connues ─────────────────────
const MIL_HEX_RANGES = [
  // USA
  { lo: 0xADF7C8, hi: 0xAFFFFF, country: 'USA',  color: '#4a9eff' },
  { lo: 0xA00000, hi: 0xA0FFFF, country: 'USA',  color: '#4a9eff' },
  // UK
  { lo: 0x43C000, hi: 0x43FFFF, country: 'GBR',  color: '#60ddff' },
  // France
  { lo: 0x3B7000, hi: 0x3B9FFF, country: 'FRA',  color: '#5588ff' },
  // Germany
  { lo: 0x3C4000, hi: 0x3C5FFF, country: 'DEU',  color: '#aaddff' },
  // Canada
  { lo: 0xC03100, hi: 0xC03FFF, country: 'CAN',  color: '#88ddff' },
  // Australia
  { lo: 0x7C4200, hi: 0x7C42FF, country: 'AUS',  color: '#66ccff' },
  // Italy
  { lo: 0x3D0000, hi: 0x3D1FFF, country: 'ITA',  color: '#99bbff' },
  // Spain
  { lo: 0x34B000, hi: 0x34BFFF, country: 'ESP',  color: '#aabbff' },
  // Netherlands
  { lo: 0x480000, hi: 0x480FFF, country: 'NLD',  color: '#88ccff' },
  // Poland
  { lo: 0x489000, hi: 0x489FFF, country: 'POL',  color: '#8899ff' },
  // Russia (VKS / VMF) — deux blocs
  { lo: 0x100000, hi: 0x1FFFFF, country: 'RUS',  color: '#ff5555' },
  { lo: 0x1A0000, hi: 0x1AFFFF, country: 'RUS',  color: '#ff5555' },
  // China (PLAAF / PLAN)
  { lo: 0x780000, hi: 0x7BFFFF, country: 'CHN',  color: '#ff6644' },
  // Iran (IRIAF)
  { lo: 0x730000, hi: 0x737FFF, country: 'IRN',  color: '#ff9933' },
  { lo: 0x738000, hi: 0x73FFFF, country: 'IRN',  color: '#ff9933' },
  // North Korea (KPAAF)
  { lo: 0x2A0000, hi: 0x2A7FFF, country: 'PRK',  color: '#cc44ff' },
  // South Korea (ROKAF)
  { lo: 0x71C000, hi: 0x71CFFF, country: 'KOR',  color: '#ffbb55' },
  // Israel (IAF)
  { lo: 0x738000, hi: 0x738FFF, country: 'ISR',  color: '#ffcc55' },
  // Turkey (THK)
  { lo: 0x4B8000, hi: 0x4B8FFF, country: 'TUR',  color: '#ffaa44' },
  // Japan (JASDF / JMSDF)
  { lo: 0x840000, hi: 0x85FFFF, country: 'JPN',  color: '#ff9966' },
  // NATO AWACS
  { lo: 0x456000, hi: 0x456FFF, country: 'NATO', color: '#00ffcc' },
];

// Callsigns militaires connus
const MIL_CALLSIGN_RE = /^(RCH|SAM|REACH|DUKE|MAGMA|COBRA|VIPER|HAWK|NATO|BAF|GAF|IAF|NAVY|USAF|CNV|TOPGUN|JOLLY|SPAR|EVAC|JAKE|SWIFT|KING|VALOR|BOXER|ATLAS|BLADE|BONE|GHOST|LANCER|FURY|RAVEN|IRON|STEEL|BRONZE|SILVER|GOLD|EAGLE|FALCON|THUNDER|STORM|WOLF|BEAR|TIGER|SHARK|LION|BORT|CCCP|PLAAF|PLANAF|IRGC)\d*/i;

// Callsigns de compagnies CIVILES connues → exclusion explicite
// Evite les faux positifs sur les plages hex larges (Chine, Russie, Iran)
const CIVILIAN_CALLSIGN_RE = /^(CCA|CES|CSN|CHH|CXA|CSZ|CSC|CDG|DKH|HXA|CQH|GCR|OKA|EPA|AXM|JAL|ANA|KAL|AAR|JJA|TWB|ABL|MAS|SIA|PAL|CPA|EVA|MXA|THA|GIA|GAR|AIC|EIN|BAW|AFR|DLH|KLM|IBE|AZA|TAP|SAS|UAL|AAL|DAL|SWA|FFT|SKW|ASA|JBU|HAL|AFL|SBI|UTN|SVR|TYA|VKO|IRM|IRC|IRA|JST|QFA|VOZ|TGW)\d+/i;

// ── Trail ─────────────────────────────────────────────────────────────────
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
  for (const [id, e] of trails) if (e.lastSeen < cutoff) trails.delete(id);
}

// ── Détection militaire ───────────────────────────────────────────────────
function detectMilitary(icao24hex, callsign) {
  // Exclure les compagnies civiles connues avant toute détection hex
  if (callsign && CIVILIAN_CALLSIGN_RE.test(callsign.trim())) return null;

  const hex = parseInt(icao24hex, 16);
  for (const r of MIL_HEX_RANGES) {
    if (hex >= r.lo && hex <= r.hi) return { country: r.country, color: r.color };
  }
  if (callsign && MIL_CALLSIGN_RE.test(callsign.trim()))
    return { country: 'UNKNOWN', color: '#e8f4ff' };
  return null;
}

// ── Normalise un objet ADS-B brut → format interne ───────────────────────
function normalizeAc(a) {
  if (Array.isArray(a)) {
    // Format OpenSky
    if (!a[5] || !a[6] || a[8]) return null;
    const icao24   = (a[0] || '').toLowerCase();
    const callsign = (a[1] || '').trim();
    const mil      = detectMilitary(icao24, callsign);
    if (!mil) return null;
    const lon = Number(a[5]), lat = Number(a[6]);
    const alt = a[7] != null ? Math.round(Number(a[7])) : null;
    return { id: icao24, callsign: callsign || icao24.toUpperCase(),
      country: mil.country, color: mil.color, lon, lat, alt,
      altFt: alt != null ? Math.round(alt * 3.281) : null,
      speed: a[9] != null ? Math.round(Number(a[9]) * 1.944) : null,
      track: a[10] != null ? Number(a[10]) : 0 };
  }

  // Format airplanes.live / adsb.fi / adsb.one
  if (a.lat == null || a.lon == null) return null;
  if (a.alt_baro === 'ground' || a.on_ground) return null;

  const icao24   = (a.hex || a.icao24 || '').toLowerCase().replace(/^~/, '');
  const callsign = (a.flight || a.callsign || a.r || '').trim();
  const mil      = detectMilitary(icao24, callsign);
  if (!mil) return null;

  const lon   = Number(a.lon);
  const lat   = Number(a.lat);
  const altFt = a.alt_baro != null && a.alt_baro !== 'ground'
    ? Math.round(Number(a.alt_baro)) : null;

  return { id: icao24, callsign: callsign || icao24.toUpperCase(),
    country: mil.country, color: mil.color, lon, lat,
    alt: altFt != null ? Math.round(altFt / 3.281) : null, altFt,
    speed: a.gs != null ? Math.round(Number(a.gs)) : null,
    track: a.track != null ? Number(a.track) : 0,
    type: (a.t || a.type || '').trim() };
}

// ── Fetch une URL avec timeout ────────────────────────────────────────────
async function fetchJson(name, url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'WorldMonitor/1.0' },
    signal:  AbortSignal.timeout(12000),
  });
  if (resp.status === 429) throw new Error(`${name} 429`);
  if (!resp.ok) throw new Error(`${name} HTTP ${resp.status}`);
  return resp.json();
}

// ── Fetch source /mil globale ─────────────────────────────────────────────
async function fetchMilSource(src) {
  try {
    const data = await fetchJson(src.name, src.url);
    const ac   = data.ac || [];
    const out  = [];

    // Rejection counters
    const rej = { noPos: 0, onGround: 0, civilianCs: 0, noMilMatch: 0 };

    for (const a of ac) {
      // Mirror normalizeAc rejection logic to count causes
      if (!Array.isArray(a)) {
        if (a.lat == null || a.lon == null)          { rej.noPos++;      continue; }
        if (a.alt_baro === 'ground' || a.on_ground)  { rej.onGround++;   continue; }
        const icao24   = (a.hex || a.icao24 || '').toLowerCase().replace(/^~/, '');
        const callsign = (a.flight || a.callsign || a.r || '').trim();
        if (callsign && CIVILIAN_CALLSIGN_RE.test(callsign)) { rej.civilianCs++; continue; }
        const hexVal = parseInt(icao24, 16);
        const hexOk  = MIL_HEX_RANGES.some(r => hexVal >= r.lo && hexVal <= r.hi);
        const csOk   = callsign && MIL_CALLSIGN_RE.test(callsign);
        if (!hexOk && !csOk)                         { rej.noMilMatch++; continue; }
      }
      const n = normalizeAc(a);
      if (n) { updateTrail(n.id, n.lon, n.lat); out.push(n); }
    }

    // Country breakdown of accepted aircraft
    const byCountry = {};
    for (const n of out) byCountry[n.country] = (byCountry[n.country] || 0) + 1;
    const countryStr = Object.entries(byCountry)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}=${n}`)
      .join(' ');

    const hexMatches = out.filter(n => {
      const hex = parseInt(n.id, 16);
      return MIL_HEX_RANGES.some(r => hex >= r.lo && hex <= r.hi);
    }).length;
    const csMatches = out.filter(n => MIL_CALLSIGN_RE.test(n.callsign)).length;
    const withType  = out.filter(n => n.type).length;

    console.log(
      `[mil-aircraft] ${src.name} raw=${ac.length} accepted=${out.length}` +
      ` hex_match=${hexMatches} callsign_match=${csMatches} with_type=${withType}`
    );
    console.log(
      `[mil-aircraft] rejected: noPos=${rej.noPos} onGround=${rej.onGround}` +
      ` civilianCs=${rej.civilianCs} noMilMatch=${rej.noMilMatch}`
    );
    if (countryStr) console.log(`[mil-aircraft] countries: ${countryStr}`);

    return out;
  } catch (e) {
    console.warn(`[mil-aircraft] ${src.name} failed: ${e.message}`);
    return [];
  }
}


// ── Cache ─────────────────────────────────────────────────────────────────
let cache = { aircraft: [], count: 0, lastUpdate: null };
let isFetching = false;

// ── Fetch principal : toutes sources en parallèle + merge ─────────────────
async function fetchMilitary() {
  if (isFetching) return;
  if (cache.lastUpdate) {
    const age = Date.now() - new Date(cache.lastUpdate).getTime();
    if (age < CACHE_MAX_AGE) return;
  }

  isFetching = true;
  purgeTrails();

  try {
    // Lancer toutes les sources /mil en parallèle
    const milResults = await Promise.all(MIL_SOURCES.map(fetchMilSource));

    // Merger + déduplication par icao24
    const seen = new Map();
    for (const list of milResults) {
      for (const ac of list) {
        if (!seen.has(ac.id)) seen.set(ac.id, ac);
      }
    }

    // Attacher les trails
    const aircraft = Array.from(seen.values()).map(ac => ({
      ...ac,
      trail: (trails.get(ac.id)?.positions || []).map(p => [p.lon, p.lat]),
    }));

    cache.aircraft   = aircraft;
    cache.count      = aircraft.length;
    cache.lastUpdate = new Date().toISOString();
    console.log(`[mil-aircraft] total merged: ${aircraft.length} aircraft`);
  } finally {
    isFetching = false;
  }
}

function getCache() { return cache; }
module.exports = { fetchMilitary, getCache };
