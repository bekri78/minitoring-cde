'use strict';

const { isMilitaryType }     = require('../data/military-types');
const { findClosestAirbase } = require('../data/military-airbases');

// ── Military Detection Rules Engine ──────────────────────────────────────
// Each rule is a pure function: (track) => { score, reason } | null
// score is 0-100 weight, reason is human-readable explanation

const RULES = [
  // ── AIS ShipType = 35 (Military Operations) ───────────────────────────
  {
    id:     'ais-type-35',
    domain: 'sea',
    weight: 70,
    fn(track) {
      if (track._raw?.shipType === 35) {
        return { score: 70, reason: 'AIS ShipType=35 (Military Operations)' };
      }
      return null;
    },
  },

  // ── ITU Warship MMSI format: 0 + MID + 5 digits ──────────────────────
  {
    id:     'itu-warship-mmsi',
    domain: 'sea',
    weight: 60,
    fn(track) {
      if (track._raw?.isWarshipFormat) {
        return { score: 60, reason: `ITU warship MMSI format (0+MID) — ${track.country}` };
      }
      return null;
    },
  },

  // ── Military vessel name prefix (USS, HMS, RFS, CNS…) ────────────────
  {
    id:     'mil-name-prefix',
    domain: 'sea',
    weight: 80,
    fn(track) {
      const MIL_NAME_RE = /^(USS|HMS|HMAS|HDMS|HNLMS|FS |FNS |RFS |INS |ROKS |JS |TCG|ITS |ESPS|NRP|HMCS|ADMIRAL |MARSHAL |VARYAG|SLAVA|MOSKVA|KUZNETSOV|UDALOY|SOVREMEN|STOIKY|NEUSTRASH|CNS |LIAONING|SHANDONG|FUJIAN|NANJING|GUANGZHOU|HARBIN|WUHAN|HAIKOU|LANZHOU|SHIJIAZHUANG)/i;
      if (track.name && MIL_NAME_RE.test(track.name)) {
        const prefix = track.name.match(MIL_NAME_RE)[0].trim();
        return { score: 80, reason: `Military name prefix: "${prefix}"` };
      }
      return null;
    },
  },

  // ── ICAO hex in known military range ──────────────────────────────────
  {
    id:     'icao-mil-hex',
    domain: 'air',
    weight: 85,
    fn(track) {
      if (track._raw?.milHexMatch) {
        return { score: 85, reason: `ICAO hex ${track.id} in ${track.country} military range` };
      }
      return null;
    },
  },

  // ── Military callsign pattern (RCH, SAM, REACH, NAVY…) ───────────────
  {
    id:     'mil-callsign',
    domain: 'air',
    weight: 50,
    fn(track) {
      const MIL_CS_RE = /^(RCH|SAM|REACH|DUKE|MAGMA|COBRA|VIPER|HAWK|NATO|BAF|GAF|IAF|NAVY|USAF|CNV|TOPGUN|JOLLY|SPAR|EVAC|JAKE|SWIFT|KING|VALOR|BOXER|ATLAS|BLADE|BONE|GHOST|LANCER|FURY|RAVEN|IRON|STEEL|BRONZE|SILVER|GOLD|EAGLE|FALCON|THUNDER|STORM|WOLF|BEAR|TIGER|SHARK|LION)\d*/i;
      const cs = track.callsign || '';
      if (cs && MIL_CS_RE.test(cs.trim())) {
        const match = cs.trim().match(MIL_CS_RE)[0];
        return { score: 50, reason: `Military callsign pattern: "${match}"` };
      }
      return null;
    },
  },

  // ── Known military ICAO aircraft type code ────────────────────────────
  {
    id:     'aircraft-type-military',
    domain: 'air',
    weight: 60,
    fn(track) {
      const t = track._raw?.aircraftType;
      if (t && isMilitaryType(t)) {
        return { score: 60, reason: `Military aircraft type: ${t.toUpperCase()}` };
      }
      return null;
    },
  },

  // ── Proximity to known military airbase (≤250 km) ─────────────────────
  {
    id:     'airbase-proximity',
    domain: 'air',
    weight: 30,
    fn(track) {
      if (track.lat == null || track.lon == null) return null;
      const ab = findClosestAirbase(track.lat, track.lon, 250);
      if (ab) {
        return { score: 30, reason: `Near military airbase: ${ab.name} (${ab.distKm} km)` };
      }
      return null;
    },
  },

  // ── High cruise altitude (>35 000 ft) — typical military mission ──────
  {
    id:     'flight-profile-high-alt',
    domain: 'air',
    weight: 15,
    fn(track) {
      const alt = track._raw?.altFt;
      if (alt != null && alt > 35000) {
        return { score: 15, reason: `High cruise altitude: ${alt} ft` };
      }
      return null;
    },
  },

  // ── High speed (>450 kts) — typical fast-jet or tanker pattern ────────
  {
    id:     'flight-profile-high-speed',
    domain: 'air',
    weight: 15,
    fn(track) {
      const spd = track._raw?.speed;
      if (spd != null && spd > 450) {
        return { score: 15, reason: `High groundspeed: ${spd} kts` };
      }
      return null;
    },
  },

  // ── PENALTY: no real callsign — only ICAO hex used as identifier ──────
  // Reduces confidence for borderline hex-range matches
  {
    id:     'penalty-no-callsign',
    domain: 'air',
    weight: -20,
    fn(track) {
      if (track._raw?.noCallsign) {
        return { score: -20, reason: 'No callsign — hex used as identifier' };
      }
      return null;
    },
  },

  // ── Known navy MID country (from MID_MAP) ─────────────────────────────
  {
    id:     'known-navy-mid',
    domain: 'sea',
    weight: 20,
    fn(track) {
      if (track._raw?.knownNavyMid && track.country) {
        return { score: 20, reason: `MMSI belongs to known navy MID (${track.country})` };
      }
      return null;
    },
  },
];

/**
 * Evaluate all applicable rules for a track.
 * @param {object} track - Normalized track object
 * @returns {{ milScore: number, milReasons: string[] }}
 */
function evaluate(track) {
  const domain = track.domain; // 'air' | 'sea'
  const reasons = [];
  let totalScore = 0;

  for (const rule of RULES) {
    if (rule.domain !== domain) continue;
    const result = rule.fn(track);
    if (result) {
      totalScore += result.score;
      reasons.push(result.reason);
    }
  }

  // Clamp: penalties can drag below 0, positive signals cap at 100
  return {
    milScore:   Math.max(0, Math.min(totalScore, 100)),
    milReasons: reasons,
  };
}

module.exports = { RULES, evaluate };
