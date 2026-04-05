'use strict';

// ── Distance Haversine (km) ───────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R  = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Pour chaque track, attache les événements GDELT dans un rayon donné.
 *
 * @param {object[]} tracks  - Tracks normalisées (ont lon/lat)
 * @param {object[]} events  - Cache GDELT (ont lon/lat)
 * @param {number}   radiusKm - Rayon de proximité (défaut 300 km)
 * @returns {object[]} tracks enrichies avec nearbyEvents[]
 */
function attachNearbyEvents(tracks, events, radiusKm = 300) {
  // Pré-filtrer les events qui ont des coordonnées valides
  const validEvents = events.filter(e =>
    typeof e.lat === 'number' && typeof e.lon === 'number' &&
    !isNaN(e.lat) && !isNaN(e.lon)
  );

  return tracks.map(track => {
    if (typeof track.lat !== 'number' || typeof track.lon !== 'number') {
      return { ...track, nearbyEvents: [] };
    }

    const nearby = validEvents
      .map(e => ({
        id:           e.id,
        title:        e.title,
        headline:     e.headline  || null,
        notes:        e.notes     || null,
        category:     e.category,
        severity:     e.severity,
        actor1:       e.actor1    || null,
        actor2:       e.actor2    || null,
        subEventType: e.subEventType || null,
        country:      e.country,
        lat:          e.lat,
        lon:          e.lon,
        url:          e.url,
        distanceKm:   Math.round(haversineKm(track.lat, track.lon, e.lat, e.lon)),
      }))
      .filter(e => e.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5); // max 5 events par track

    return { ...track, nearbyEvents: nearby };
  });
}

module.exports = { attachNearbyEvents };
