'use strict';

const { evaluate } = require('./rules');

// ── Classification tiers ─────────────────────────────────────────────────
// Score thresholds determine confidence tier
const TIERS = [
  { min: 75, tier: 'confirmed_military', label: 'Confirmed Military' },
  { min: 50, tier: 'likely_military',    label: 'Likely Military'    },
  { min: 25, tier: 'possible_state',     label: 'Possible State'    },
];

/**
 * Score a normalized track and assign a military classification tier.
 * @param {object} track - Normalized track (domain, id, name, country, _raw, etc.)
 * @returns {object} track augmented with milScore, milTier, milReasons[]
 */
function classify(track) {
  const { milScore, milReasons } = evaluate(track);

  let milTier = 'unknown';
  for (const t of TIERS) {
    if (milScore >= t.min) {
      milTier = t.tier;
      break;
    }
  }

  return {
    ...track,
    milScore,
    milTier,
    milReasons,
  };
}

/**
 * Filter tracks: only return those at or above a minimum tier.
 * Default: return everything with score > 0 (i.e. at least one rule matched).
 */
function filterByTier(tracks, minTier = 'possible_state') {
  const tierOrder = { confirmed_military: 3, likely_military: 2, possible_state: 1, unknown: 0 };
  const minLevel = tierOrder[minTier] || 0;
  return tracks.filter(t => (tierOrder[t.milTier] || 0) >= minLevel);
}

module.exports = { classify, filterByTier, TIERS };
