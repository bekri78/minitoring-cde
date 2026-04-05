'use strict';

// ── Cache photos avions — planespotters.net public API ────────────────────
// GET https://api.planespotters.net/pub/photos/hex/{icao24}
// Pas de clé API requise, rate-limit: ~1 req/s recommandé

const photoCache = new Map(); // icao24 → { photoLink, photographer, aircraftType, registration, expiresAt }
const CACHE_TTL  = 24 * 60 * 60 * 1000; // 24h
const pendingReqs = new Map(); // évite les requêtes dupliquées en cours

async function fetchAircraftPhoto(icao24) {
  if (!icao24) return null;
  const key = icao24.toLowerCase();

  const cached = photoCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;

  // Dédupliquer les requêtes simultanées pour le même icao24
  if (pendingReqs.has(key)) return pendingReqs.get(key);

  const promise = (async () => {
    try {
      const resp = await fetch(`https://api.planespotters.net/pub/photos/hex/${key}`, {
        headers: { 'User-Agent': 'MilitaryTracker/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const photo = data?.photos?.[0];
      if (!photo) return null;

      const result = {
        photoLink:    photo.link         || null,
        thumbnail:    photo.thumbnail?.src || null,
        photographer: photo.photographer  || null,
        aircraftType: photo.aircraft?.model || null,
        registration: photo.aircraft?.reg   || null,
        expiresAt:    Date.now() + CACHE_TTL,
      };
      photoCache.set(key, result);
      return result;
    } catch {
      return null;
    } finally {
      pendingReqs.delete(key);
    }
  })();

  pendingReqs.set(key, promise);
  return promise;
}

module.exports = { fetchAircraftPhoto };
