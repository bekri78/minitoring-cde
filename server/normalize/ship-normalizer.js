'use strict';

// ── MID_MAP (duplicated from military-ships.js for normalizer isolation) ──
const MID_MAP = {
  '338': { country: 'USA', color: '#4a9eff' },
  '366': { country: 'USA', color: '#4a9eff' },
  '367': { country: 'USA', color: '#4a9eff' },
  '368': { country: 'USA', color: '#4a9eff' },
  '369': { country: 'USA', color: '#4a9eff' },
  '232': { country: 'GBR', color: '#60ddff' },
  '233': { country: 'GBR', color: '#60ddff' },
  '234': { country: 'GBR', color: '#60ddff' },
  '235': { country: 'GBR', color: '#60ddff' },
  '226': { country: 'FRA', color: '#5588ff' },
  '227': { country: 'FRA', color: '#5588ff' },
  '228': { country: 'FRA', color: '#5588ff' },
  '211': { country: 'DEU', color: '#aaddff' },
  '212': { country: 'DEU', color: '#aaddff' },
  '316': { country: 'CAN', color: '#88ddff' },
  '503': { country: 'AUS', color: '#66ccff' },
  '247': { country: 'ITA', color: '#99bbff' },
  '248': { country: 'ITA', color: '#99bbff' },
  '224': { country: 'ESP', color: '#aabbff' },
  '225': { country: 'ESP', color: '#aabbff' },
  '244': { country: 'NLD', color: '#88ccff' },
  '245': { country: 'NLD', color: '#88ccff' },
  '261': { country: 'POL', color: '#8899ff' },
  '273': { country: 'RUS', color: '#ff5555' },
  '412': { country: 'CHN', color: '#ff6644' },
  '413': { country: 'CHN', color: '#ff6644' },
  '414': { country: 'CHN', color: '#ff6644' },
  '477': { country: 'CHN', color: '#ff6644' },
  '431': { country: 'JPN', color: '#ffdd55' },
  '432': { country: 'JPN', color: '#ffdd55' },
  '440': { country: 'KOR', color: '#ffffaa' },
  '441': { country: 'KOR', color: '#ffffaa' },
  '419': { country: 'IND', color: '#ffcc66' },
  '422': { country: 'IRN', color: '#ff4444' },
  '378': { country: 'TUR', color: '#ffaa44' },
  '271': { country: 'TUR', color: '#ffaa44' },
  '276': { country: 'ISR', color: '#ffcc55' },
  '563': { country: 'SGP', color: '#55ffcc' },
  '525': { country: 'IDN', color: '#66ff99' },
  '636': { country: 'LBR', color: '#aabbcc' },
};

function mmsiLookup(mmsi) {
  const s = String(mmsi).padStart(9, '0');
  const isWarshipFormat = s.startsWith('0') && !s.startsWith('00');
  const lookupStr = isWarshipFormat ? s.slice(1) : s;
  for (let len = 3; len >= 2; len--) {
    const prefix = lookupStr.slice(0, len);
    if (MID_MAP[prefix]) return { ...MID_MAP[prefix], isWarshipFormat };
  }
  return null;
}

/**
 * Normalize a raw ship object (from military-ships.js cache)
 * into the unified Track schema.
 */
function normalizeShip(raw) {
  const mid = mmsiLookup(raw.id);

  return {
    domain:    'sea',
    id:        raw.id,                          // MMSI
    name:      raw.name || raw.id,
    callsign:  raw.callsign || '',
    country:   raw.country || (mid ? mid.country : 'UNKNOWN'),
    color:     raw.color   || (mid ? mid.color   : '#e8f4ff'),
    lon:       raw.lon,
    lat:       raw.lat,
    alt:       null,
    altFt:     null,
    speed:     raw.sog ?? null,                 // knots
    heading:   raw.heading,
    cog:       raw.cog ?? 0,
    sog:       raw.sog ?? 0,
    lastSeen:  raw.lastSeen || Date.now(),
    trail:     raw.trail || [],
    // _raw carries source-specific data for rule evaluation
    _raw: {
      source:         'ais',
      mmsi:           raw.id,
      shipType:       raw.shipType ?? (raw.milVerified ? 35 : null),
      isWarshipFormat: mid ? mid.isWarshipFormat : false,
      knownNavyMid:   !!mid,
      name:           raw.name || '',
    },
  };
}

module.exports = { normalizeShip, MID_MAP };
