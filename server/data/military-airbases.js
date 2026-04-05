'use strict';

// Major military airbases worldwide with WGS-84 coordinates.
// Used for proximity scoring: an aircraft near a known military airbase
// is more likely to be on a military mission (departure/arrival pattern).
//
// Threshold used in the rule: 250 km radius.
// Sources: public ICAO/FAA charts, Wikipedia, OurAirports.
const MILITARY_AIRBASES = [
  // ── United States ────────────────────────────────────────────────────────
  { name: 'Andrews AFB',             country: 'USA', lat: 38.810,  lon: -76.867  },
  { name: 'Eglin AFB',               country: 'USA', lat: 30.483,  lon: -86.526  },
  { name: 'Edwards AFB',             country: 'USA', lat: 34.905,  lon: -117.884 },
  { name: 'Nellis AFB',              country: 'USA', lat: 36.236,  lon: -115.034 },
  { name: 'Wright-Patterson AFB',    country: 'USA', lat: 39.826,  lon: -84.048  },
  { name: 'Langley AFB',             country: 'USA', lat: 37.083,  lon: -76.360  },
  { name: 'Tinker AFB',              country: 'USA', lat: 35.415,  lon: -97.387  },
  { name: 'Barksdale AFB',           country: 'USA', lat: 32.502,  lon: -93.663  },
  { name: 'Whiteman AFB',            country: 'USA', lat: 38.728,  lon: -93.548  },
  { name: 'Offutt AFB',              country: 'USA', lat: 41.118,  lon: -95.913  },
  { name: 'McConnell AFB',           country: 'USA', lat: 37.622,  lon: -97.268  },
  { name: 'MacDill AFB',             country: 'USA', lat: 27.849,  lon: -82.521  },
  { name: 'Dyess AFB',               country: 'USA', lat: 32.421,  lon: -99.855  },
  { name: 'Minot AFB',               country: 'USA', lat: 48.416,  lon: -101.358 },
  { name: 'Ellsworth AFB',           country: 'USA', lat: 44.145,  lon: -103.100 },
  { name: 'Fairchild AFB',           country: 'USA', lat: 47.615,  lon: -117.656 },
  { name: 'Travis AFB',              country: 'USA', lat: 38.263,  lon: -121.928 },
  { name: 'Dover AFB',               country: 'USA', lat: 39.130,  lon: -75.466  },
  { name: 'Scott AFB',               country: 'USA', lat: 38.544,  lon: -89.855  },
  { name: 'Seymour Johnson AFB',     country: 'USA', lat: 35.340,  lon: -77.961  },
  { name: 'Andersen AFB (Guam)',     country: 'USA', lat: 13.584,  lon: 144.929  },
  { name: 'Hickam AFB',              country: 'USA', lat: 21.340,  lon: -157.943 },
  // ── US overseas ──────────────────────────────────────────────────────────
  { name: 'Ramstein AB',             country: 'DEU', lat: 49.437,  lon: 7.600    },
  { name: 'Spangdahlem AB',          country: 'DEU', lat: 50.126,  lon: 6.692    },
  { name: 'RAF Lakenheath',          country: 'GBR', lat: 52.409,  lon: 0.560    },
  { name: 'RAF Mildenhall',          country: 'GBR', lat: 52.362,  lon: 0.486    },
  { name: 'Aviano AB',               country: 'ITA', lat: 46.031,  lon: 12.596   },
  { name: 'Incirlik AB',             country: 'TUR', lat: 37.002,  lon: 35.426   },
  { name: 'Kadena AB',               country: 'JPN', lat: 26.356,  lon: 127.768  },
  { name: 'Yokota AB',               country: 'JPN', lat: 35.748,  lon: 139.346  },
  { name: 'Osan AB',                 country: 'KOR', lat: 37.090,  lon: 127.030  },
  { name: 'Kunsan AB',               country: 'KOR', lat: 35.904,  lon: 126.616  },
  { name: 'Al Udeid AB',             country: 'QAT', lat: 25.117,  lon: 51.315   },
  { name: 'Al Dhafra AB',            country: 'ARE', lat: 24.248,  lon: 54.548   },
  { name: 'Prince Sultan AB',        country: 'SAU', lat: 24.062,  lon: 47.581   },
  { name: 'Lajes AB (Azores)',       country: 'PRT', lat: 38.762,  lon: -27.090  },
  // ── United Kingdom ───────────────────────────────────────────────────────
  { name: 'RAF Coningsby',           country: 'GBR', lat: 53.093,  lon: -0.166   },
  { name: 'RAF Lossiemouth',         country: 'GBR', lat: 57.705,  lon: -3.339   },
  { name: 'RAF Northolt',            country: 'GBR', lat: 51.553,  lon: -0.418   },
  { name: 'RAF Waddington',          country: 'GBR', lat: 53.166,  lon: -0.524   },
  { name: 'RAF Brize Norton',        country: 'GBR', lat: 51.750,  lon: -1.583   },
  { name: 'RAF Valley',              country: 'GBR', lat: 53.248,  lon: -4.535   },
  // ── France ───────────────────────────────────────────────────────────────
  { name: 'BA 107 Villacoublay',     country: 'FRA', lat: 48.775,  lon: 2.201    },
  { name: 'BA 113 Saint-Dizier',     country: 'FRA', lat: 48.636,  lon: 4.900    },
  { name: 'BA 118 Mont-de-Marsan',   country: 'FRA', lat: 43.909,  lon: -0.500   },
  { name: 'BA 123 Orléans',          country: 'FRA', lat: 47.988,  lon: 1.761    },
  { name: 'BA 702 Avord',            country: 'FRA', lat: 47.053,  lon: 2.634    },
  { name: 'BA 942 Lyon-Mont Verdun', country: 'FRA', lat: 45.812,  lon: 4.930    },
  // ── Germany ──────────────────────────────────────────────────────────────
  { name: 'Nörvenich AB',            country: 'DEU', lat: 50.832,  lon: 6.659    },
  { name: 'Büchel AB',               country: 'DEU', lat: 50.173,  lon: 7.064    },
  { name: 'Wittmund AB',             country: 'DEU', lat: 53.548,  lon: 7.667    },
  { name: 'Laage AB',                country: 'DEU', lat: 53.919,  lon: 12.279   },
  { name: 'Neuburg AB',              country: 'DEU', lat: 48.712,  lon: 11.210   },
  // ── Netherlands ──────────────────────────────────────────────────────────
  { name: 'Volkel AB',               country: 'NLD', lat: 51.657,  lon: 5.707    },
  { name: 'Leeuwarden AB',           country: 'NLD', lat: 53.228,  lon: 5.761    },
  // ── Italy ────────────────────────────────────────────────────────────────
  { name: 'Decimomannu AB',          country: 'ITA', lat: 39.354,  lon: 8.972    },
  { name: 'Ghedi AB',                country: 'ITA', lat: 45.433,  lon: 10.267   },
  { name: 'Amendola AB',             country: 'ITA', lat: 41.533,  lon: 15.718   },
  // ── Turkey ───────────────────────────────────────────────────────────────
  { name: 'Konya AB',                country: 'TUR', lat: 37.979,  lon: 32.561   },
  { name: 'Akinci AB (Mürted)',      country: 'TUR', lat: 40.097,  lon: 32.571   },
  { name: 'Balikesir AB',            country: 'TUR', lat: 39.619,  lon: 27.926   },
  // ── Spain ────────────────────────────────────────────────────────────────
  { name: 'Rota Naval Station',      country: 'ESP', lat: 36.645,  lon: -6.349   },
  { name: 'Morón AB',                country: 'ESP', lat: 37.175,  lon: -5.615   },
  { name: 'Torrejón AB',             country: 'ESP', lat: 40.496,  lon: -3.446   },
  // ── Russia ───────────────────────────────────────────────────────────────
  { name: 'Khmeimim AB (Syria)',     country: 'RUS', lat: 35.401,  lon: 37.233   },
  { name: 'Kubinka AB',              country: 'RUS', lat: 55.578,  lon: 36.660   },
  { name: 'Engels AB',               country: 'RUS', lat: 51.814,  lon: 46.177   },
  { name: 'Olenya AB',               country: 'RUS', lat: 68.152,  lon: 33.463   },
  { name: 'Lipetsk AB',              country: 'RUS', lat: 52.704,  lon: 39.537   },
  { name: 'Akhtubinsk AB',           country: 'RUS', lat: 48.290,  lon: 46.190   },
  { name: 'Mozdok AB',               country: 'RUS', lat: 43.788,  lon: 44.599   },
  { name: 'Saki AB (Crimea)',        country: 'RUS', lat: 45.113,  lon: 33.591   },
  { name: 'Chelyabinsk AB',          country: 'RUS', lat: 55.305,  lon: 61.504   },
  { name: 'Millerovo AB',            country: 'RUS', lat: 48.931,  lon: 40.389   },
  // ── China ────────────────────────────────────────────────────────────────
  { name: 'Sanya AB',                country: 'CHN', lat: 18.092,  lon: 109.412  },
  { name: 'Lingshui AB',             country: 'CHN', lat: 18.498,  lon: 110.036  },
  { name: 'Dingxin AB',              country: 'CHN', lat: 40.540,  lon: 99.897   },
  { name: 'Guilin AB',               country: 'CHN', lat: 25.218,  lon: 110.039  },
  { name: 'Hotan AB',                country: 'CHN', lat: 37.036,  lon: 79.866   },
  // ── Israel ───────────────────────────────────────────────────────────────
  { name: 'Nevatim AB',              country: 'ISR', lat: 31.208,  lon: 35.012   },
  { name: 'Ramat David AB',          country: 'ISR', lat: 32.665,  lon: 35.179   },
  { name: 'Tel Nof AB',              country: 'ISR', lat: 31.840,  lon: 34.817   },
  // ── Japan ────────────────────────────────────────────────────────────────
  { name: 'Misawa AB',               country: 'JPN', lat: 40.703,  lon: 141.368  },
  { name: 'Hyakuri AB',              country: 'JPN', lat: 36.181,  lon: 140.415  },
  { name: 'Komatsu AB',              country: 'JPN', lat: 36.394,  lon: 136.407  },
  { name: 'Nyutabaru AB',            country: 'JPN', lat: 32.083,  lon: 131.451  },
  // ── South Korea ──────────────────────────────────────────────────────────
  { name: 'Cheongju AB',             country: 'KOR', lat: 36.717,  lon: 127.499  },
  { name: 'Gwangju AB',              country: 'KOR', lat: 35.124,  lon: 126.807  },
  // ── Australia ────────────────────────────────────────────────────────────
  { name: 'RAAF Darwin',             country: 'AUS', lat: -12.421, lon: 130.876  },
  { name: 'RAAF Edinburgh',          country: 'AUS', lat: -34.702, lon: 138.621  },
  { name: 'RAAF Williamtown',        country: 'AUS', lat: -32.795, lon: 151.834  },
  { name: 'RAAF Amberley',           country: 'AUS', lat: -27.637, lon: 152.712  },
  // ── India ────────────────────────────────────────────────────────────────
  { name: 'Hindon AB',               country: 'IND', lat: 28.711,  lon: 77.357   },
  { name: 'Ambala AB',               country: 'IND', lat: 30.368,  lon: 76.784   },
  { name: 'Hashimara AB',            country: 'IND', lat: 26.695,  lon: 89.368   },
  // ── Pakistan ─────────────────────────────────────────────────────────────
  { name: 'Nur Khan AB',             country: 'PAK', lat: 33.617,  lon: 73.100   },
  { name: 'Mushaf AB (Sargodha)',    country: 'PAK', lat: 32.048,  lon: 72.665   },
  // ── Iran ─────────────────────────────────────────────────────────────────
  { name: 'Mehrabad AB',             country: 'IRN', lat: 35.689,  lon: 51.314   },
  { name: 'Shahid Nojeh AB',        country: 'IRN', lat: 35.211,  lon: 48.654   },
  { name: 'Isfahan AB',              country: 'IRN', lat: 32.533,  lon: 51.697   },
  // ── Jordan / Middle East ─────────────────────────────────────────────────
  { name: 'Muwaffaq Salti AB',       country: 'JOR', lat: 31.827,  lon: 36.787   },
  // ── Norway / NATO Arctic ─────────────────────────────────────────────────
  { name: 'Bodø AB',                 country: 'NOR', lat: 67.269,  lon: 14.365   },
  { name: 'Ørland AB',               country: 'NOR', lat: 63.699,  lon: 9.604    },
  // ── Poland ───────────────────────────────────────────────────────────────
  { name: 'Malbork AB',              country: 'POL', lat: 54.027,  lon: 19.134   },
  { name: 'Świdwin AB',              country: 'POL', lat: 53.791,  lon: 15.826   },
];

const DEG2RAD = Math.PI / 180;

/**
 * Haversine distance in km between two WGS-84 points.
 */
function distKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) *
    Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Find the closest airbase within `maxKm` kilometres.
 * Returns { name, country, distKm } or null.
 */
function findClosestAirbase(lat, lon, maxKm = 250) {
  let best = null;
  let bestDist = maxKm;
  for (const ab of MILITARY_AIRBASES) {
    const d = distKm(lat, lon, ab.lat, ab.lon);
    if (d < bestDist) {
      bestDist = d;
      best = { name: ab.name, country: ab.country, distKm: Math.round(d) };
    }
  }
  return best;
}

module.exports = { MILITARY_AIRBASES, findClosestAirbase, distKm };
