'use strict';

// ── ISO-3 → ISO-2 pour flagcdn.com ────────────────────────────────────────
const ISO3_TO_2 = {
  USA:'us', GBR:'gb', FRA:'fr', DEU:'de', CAN:'ca', AUS:'au', ITA:'it', ESP:'es',
  NLD:'nl', POL:'pl', RUS:'ru', CHN:'cn', JPN:'jp', KOR:'kr', IND:'in', IRN:'ir',
  TUR:'tr', ISR:'il', SGP:'sg', IDN:'id', LBR:'lr', NOR:'no', GRC:'gr', DNK:'dk',
  SWE:'se', FIN:'fi', BRA:'br', ARG:'ar', ZAF:'za', EGY:'eg', PAK:'pk', BGD:'bd',
};

const infoCache = new Map(); // mmsi → result
const CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Retourne les infos visuelles d'un navire :
 *  - thumbnail  : photo MarineTraffic (peut 404, le client gère le fallback)
 *  - photoLink  : lien vers la galerie MarineTraffic
 *  - flagUrl    : drapeau pays via flagcdn.com (fallback fiable)
 *  - country    : ISO-3
 */
async function fetchShipPhoto(mmsi, country) {
  if (!mmsi) return null;
  const key = String(mmsi);

  const cached = infoCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const iso2      = ISO3_TO_2[country] || null;
  const flagUrl   = iso2 ? `https://flagcdn.com/w80/${iso2}.png` : null;
  const thumbnail = `https://photos.marinetraffic.com/ais/showphoto.aspx?mmsi=${key}`;
  const photoLink = `https://www.marinetraffic.com/en/photos/of/vessels/mmsi:${key}/`;

  const result = { thumbnail, photoLink, flagUrl, expiresAt: Date.now() + CACHE_TTL };
  infoCache.set(key, result);
  return result;
}

module.exports = { fetchShipPhoto };
