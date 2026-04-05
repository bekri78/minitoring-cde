'use strict';

// ── ICAO hex ranges (duplicated from military-aircraft.js for normalizer isolation) ──
const MIL_HEX_RANGES = [
  { lo: 0xADF7C8, hi: 0xAFFFFF, country: 'USA',  color: '#4a9eff' },
  { lo: 0xA00000, hi: 0xA0FFFF, country: 'USA',  color: '#4a9eff' },
  { lo: 0x43C000, hi: 0x43FFFF, country: 'GBR',  color: '#60ddff' },
  { lo: 0x3B7000, hi: 0x3B9FFF, country: 'FRA',  color: '#5588ff' },
  { lo: 0x3C4000, hi: 0x3C5FFF, country: 'DEU',  color: '#aaddff' },
  { lo: 0xC03100, hi: 0xC03FFF, country: 'CAN',  color: '#88ddff' },
  { lo: 0x7C4200, hi: 0x7C42FF, country: 'AUS',  color: '#66ccff' },
  { lo: 0x3D0000, hi: 0x3D1FFF, country: 'ITA',  color: '#99bbff' },
  { lo: 0x34B000, hi: 0x34BFFF, country: 'ESP',  color: '#aabbff' },
  { lo: 0x480000, hi: 0x480FFF, country: 'NLD',  color: '#88ccff' },
  { lo: 0x489000, hi: 0x489FFF, country: 'POL',  color: '#8899ff' },
  { lo: 0x1A0000, hi: 0x1AFFFF, country: 'RUS',  color: '#ff5555' },
  { lo: 0x100000, hi: 0x1FFFFF, country: 'RUS',  color: '#ff5555' },
  { lo: 0x780000, hi: 0x7BFFFF, country: 'CHN',  color: '#ff6644' },
  { lo: 0x738000, hi: 0x738FFF, country: 'ISR',  color: '#ffcc55' },
  { lo: 0x4B8000, hi: 0x4B8FFF, country: 'TUR',  color: '#ffaa44' },
  { lo: 0x840000, hi: 0x85FFFF, country: 'JPN',  color: '#ff9966' },
  { lo: 0x71C000, hi: 0x71CFFF, country: 'KOR',  color: '#ffbb55' },
  { lo: 0x456000, hi: 0x456FFF, country: 'NATO', color: '#00ffcc' },
];

function hexToMil(icao24hex) {
  const hex = parseInt(icao24hex, 16);
  for (const r of MIL_HEX_RANGES) {
    if (hex >= r.lo && hex <= r.hi) return r;
  }
  return null;
}

/**
 * Normalize a raw aircraft object (from military-aircraft.js cache)
 * into the unified Track schema.
 */
function normalizeAircraft(raw) {
  const milHex = hexToMil(raw.id);

  return {
    domain:    'air',
    id:        raw.id,                         // icao24
    name:      raw.callsign || raw.id.toUpperCase(),
    callsign:  raw.callsign || '',
    country:   raw.country || (milHex ? milHex.country : 'UNKNOWN'),
    color:     raw.color   || (milHex ? milHex.color   : '#e8f4ff'),
    lon:       raw.lon,
    lat:       raw.lat,
    alt:       raw.alt,                        // metres
    altFt:     raw.altFt,                      // feet
    speed:     raw.speed,                      // knots
    heading:   raw.track ?? null,              // degrees
    cog:       raw.track ?? 0,
    sog:       raw.speed ?? 0,
    lastSeen:  Date.now(),
    trail:     raw.trail || [],
    // _raw carries source-specific data for rule evaluation
    _raw: {
      source:      'adsb',
      milHexMatch: !!milHex,
      icao24:      raw.id,
      callsign:    raw.callsign || '',
      aircraftType: raw.type || '',
      altFt:       raw.altFt  ?? null,
      speed:       raw.speed  ?? null,
      noCallsign:  !raw.callsign || raw.callsign === raw.id?.toUpperCase(),
    },
  };
}

module.exports = { normalizeAircraft, MIL_HEX_RANGES };
