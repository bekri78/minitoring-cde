'use strict';

const { normalizeAircraft } = require('./normalize/aircraft-normalizer');
const { normalizeShip }     = require('./normalize/ship-normalizer');
const { classify, filterByTier } = require('./scoring/military-scorer');

/**
 * Unified OSINT pipeline:
 *   raw sources → normalize → score → classify → filter → unified tracks
 *
 * @param {object} opts
 * @param {Array}  opts.aircraft - Raw aircraft from military-aircraft.js getCache().aircraft
 * @param {Array}  opts.ships    - Raw ships from military-ships.js getCache().ships
 * @param {string} [opts.minTier='possible_state'] - Minimum tier to include
 * @param {string} [opts.domain]  - Filter by domain: 'air', 'sea', or undefined for both
 * @param {string} [opts.country] - Filter by country code (e.g. 'USA', 'RUS')
 * @returns {{ tracks: object[], meta: object }}
 */
function runPipeline({ aircraft = [], ships = [], minTier = 'possible_state', domain, country } = {}) {
  const t0 = Date.now();

  // 1. Normalize
  const normalizedAir = aircraft.map(normalizeAircraft);
  const normalizedSea = ships.map(normalizeShip);
  const allNormalized = [...normalizedAir, ...normalizedSea];

  // 2. Score & classify
  const classified = allNormalized.map(classify);

  // 3. Filter by tier
  let tracks = filterByTier(classified, minTier);

  // 4. Optional domain filter
  if (domain) {
    tracks = tracks.filter(t => t.domain === domain);
  }

  // 5. Optional country filter
  if (country) {
    const c = country.toUpperCase();
    tracks = tracks.filter(t => t.country === c);
  }

  // 6. Sort by score descending
  tracks.sort((a, b) => b.milScore - a.milScore);

  // 7. Strip _raw from output (internal only)
  const clean = tracks.map(({ _raw, ...rest }) => rest);

  const meta = {
    totalNormalized: allNormalized.length,
    totalClassified: classified.length,
    totalFiltered:   clean.length,
    airCount:        clean.filter(t => t.domain === 'air').length,
    seaCount:        clean.filter(t => t.domain === 'sea').length,
    pipelineMs:      Date.now() - t0,
    timestamp:       new Date().toISOString(),
  };

  return { tracks: clean, meta };
}

module.exports = { runPipeline };
