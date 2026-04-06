'use strict';

// ── Type sets par mission ─────────────────────────────────────────────────────
// Les codes ICAO correspondent à ceux déjà présents dans military-types.js

const AWACS_TYPES = new Set([
  'E3',       // Boeing E-3 Sentry (USAF/NATO/RAF/RSAF)
  'E7',       // Boeing 737 AEW&C (Wedgetail — Australie, Turquie, Corée)
  'A50',      // Beriev A-50 Mainstay (Russie)
  'KJ2000',   // Ilyushin-76-based AEW (Chine)
  'KJ500',    // Y-9-based AEW (Chine)
  'E737',     // Boeing 737 AEW (autre code ICAO pour Wedgetail)
  'E767',     // E-767 (JASDF Japon)
  'E2',       // E-2 Hawkeye (US Navy, embarqué)
]);

const TANKER_TYPES = new Set([
  'KC135',  // KC-135 Stratotanker (USAF)
  'KC10',   // KC-10 Extender (USAF)
  'KC46',   // KC-46 Pegasus (USAF)
  'MRTT',   // A330 MRTT (Airbus)
  'IL78',   // IL-78 Midas (Russie)
  'Y20U',   // Y-20U (ravitailleur chinois)
  'A310',   // A310 MRTT (Canada, Allemagne)
]);

const ISR_TYPES = new Set([
  'RC135',   // RC-135 (USAF SIGINT/ELINT)
  'EP3',     // EP-3 Aries (US Navy SIGINT)
  'P8',      // P-8 Poseidon (ASW / SIGINT)
  'P3',      // P-3 Orion (ASW / surveillance)
  'P1',      // P-1 (JMSDF)
  'U2',      // U-2 (USAF HUMINT/imagery)
  'TR1',     // TR-1 (variante U-2)
  'E8',      // E-8 JSTARS (surveillance sol)
  'S3',      // S-3 Viking (US Navy)
  'RQ4',     // Global Hawk (UAV ISR)
  'MQ9',     // MQ-9 Reaper (UAV armed/ISR)
  'MQ1',     // MQ-1 Predator (UAV)
  'TU214R',  // Tu-214R (Russie SIGINT) — code informel
  'Y8G',     // Y-8G (Chine ELINT) — code informel
]);

// ── Constantes historique ──────────────────────────────────────────────────────
const TRACK_MAX_PTS   = 30;
const TRACK_EXPIRE_MS = 10 * 60 * 1000; // 10 minutes

// trackHistory: hex → [{ lat, lon, alt, speed, heading, time }]
const trackHistory = new Map();

// ── Gestion de l'historique ───────────────────────────────────────────────────

/**
 * Ajoute la position courante d'un avion à son historique.
 * Appelé après la déduplication dans fetchMilitary().
 * @param {object} ac - avion normalisé (format military-aircraft.js)
 */
function updateHistory(ac) {
  if (ac.lat == null || ac.lon == null) return;
  const pts = trackHistory.get(ac.id) || [];
  pts.push({
    lat:     ac.lat,
    lon:     ac.lon,
    alt:     ac.altFt,
    speed:   ac.speed,
    heading: ac.track || 0,
    time:    Date.now(),
  });
  if (pts.length > TRACK_MAX_PTS) pts.shift();
  trackHistory.set(ac.id, pts);
}

/**
 * Supprime les entrées d'avions absents depuis plus de TRACK_EXPIRE_MS.
 * Appelé avant chaque cycle de fetch.
 */
function purgeHistory() {
  const cutoff = Date.now() - TRACK_EXPIRE_MS;
  for (const [id, pts] of trackHistory) {
    if (!pts.length || pts[pts.length - 1].time < cutoff) {
      trackHistory.delete(id);
    }
  }
}

// ── Helpers mathématiques ─────────────────────────────────────────────────────

function variance(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}

// Différence angulaire normalisée dans [-180, 180]
function angleDiff(from, to) {
  return ((to - from + 540) % 360) - 180;
}

// Distance Haversine en km entre deux points lat/lon
function haversinKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180)
             * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Détection d'orbite ────────────────────────────────────────────────────────

/**
 * Détecte si un avion décrit une orbite (cercle ou ovale).
 *
 * Deux méthodes complémentaires :
 *  1. Accumulation de heading — somme des deltas de cap successifs
 *  2. Cohérence du rayon par rapport au centroïde (coefficient de variation)
 *
 * @param {Array} history - tableau de positions { lat, lon, heading, ... }
 * @returns {{ isOrbit: boolean, totalRotation: number, radius_km: number }}
 */
function detectOrbit(history) {
  if (history.length < 8) return { isOrbit: false, totalRotation: 0, radius_km: 0 };

  // Méthode 1 : accumulation de heading
  let totalRotation = 0;
  for (let i = 1; i < history.length; i++) {
    totalRotation += angleDiff(history[i - 1].heading, history[i].heading);
  }
  const absRotation = Math.abs(totalRotation);

  // Méthode 2 : cohérence radiale par rapport au centroïde
  const centLat = history.reduce((s, p) => s + p.lat, 0) / history.length;
  const centLon = history.reduce((s, p) => s + p.lon, 0) / history.length;
  const radii   = history.map(p => haversinKm(p.lat, p.lon, centLat, centLon));
  const meanR   = radii.reduce((s, r) => s + r, 0) / radii.length;
  const cvR     = meanR > 0 ? Math.sqrt(variance(radii)) / meanR : 1;

  // Orbite si :
  //   - rotation >= 270° (¾ de cercle visible dans l'historique), OU
  //   - rayon cohérent (CV < 0.25) + rayon > 5 km + rotation partielle > 90°
  const isOrbit = absRotation >= 270
    || (cvR < 0.25 && meanR > 5 && absRotation > 90);

  return {
    isOrbit,
    totalRotation: Math.round(absRotation),
    radius_km:     Math.round(meanR),
  };
}

// ── Stabilité de vitesse ──────────────────────────────────────────────────────

function isSpeedStable(history) {
  const speeds = history.map(p => p.speed).filter(s => s != null && s > 50);
  if (speeds.length < 4) return false;
  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
  return mean > 0 && Math.sqrt(variance(speeds)) / mean < 0.10; // CV < 10 %
}

// ── Stabilité d'altitude ──────────────────────────────────────────────────────

function isAltStable(history) {
  const alts = history.map(p => p.alt).filter(a => a != null && a > 0);
  if (alts.length < 4) return false;
  return Math.sqrt(variance(alts)) < 2000; // stddev < 2000 ft
}

// ── Correspondance de type ────────────────────────────────────────────────────

function typeMatch(rawType, typeSet) {
  if (!rawType) return false;
  return typeSet.has(rawType.toUpperCase().trim());
}

// ── Détection AWACS ───────────────────────────────────────────────────────────

/**
 * Score max : 115 pts
 *   type_match  : 60
 *   altitude_ok : 20
 *   speed_stable: 10
 *   orbit       : 25
 */
function detectAwacs(ac, history) {
  if (!typeMatch(ac.type, AWACS_TYPES)) return null;

  let score = 60;
  const reasons = ['type_match'];

  if (ac.altFt != null && ac.altFt >= 28000 && ac.altFt <= 40000) {
    score += 20; reasons.push('altitude_ok');
  }
  if (isSpeedStable(history))  { score += 10; reasons.push('speed_stable'); }

  const orbit = detectOrbit(history);
  if (orbit.isOrbit) { score += 25; reasons.push('orbit'); }

  return {
    type:       'AWACS',
    score,
    confidence: parseFloat(Math.min(score / 115, 1).toFixed(2)),
    reasons,
    orbit,
  };
}

// ── Détection ravitailleur ────────────────────────────────────────────────────

/**
 * Score max : 95 pts
 *   type_match  : 60
 *   altitude_ok : 20
 *   speed_stable: 15
 */
function detectTanker(ac, history) {
  if (!typeMatch(ac.type, TANKER_TYPES)) return null;

  let score = 60;
  const reasons = ['type_match'];

  if (ac.altFt != null && ac.altFt >= 18000 && ac.altFt <= 32000) {
    score += 20; reasons.push('altitude_ok');
  }
  if (isSpeedStable(history)) { score += 15; reasons.push('speed_stable'); }

  return {
    type:       'TANKER',
    score,
    confidence: parseFloat(Math.min(score / 95, 1).toFixed(2)),
    reasons,
  };
}

// ── Détection ISR / surveillance ──────────────────────────────────────────────

/**
 * Score max : 105 pts
 *   type_match  : 60
 *   altitude_ok : 15
 *   long_track  : 10
 *   orbit       : 20
 */
function detectISR(ac, history) {
  if (!typeMatch(ac.type, ISR_TYPES)) return null;

  let score = 60;
  const reasons = ['type_match'];

  if (ac.altFt != null && ac.altFt >= 20000) {
    score += 15; reasons.push('altitude_ok');
  }
  if (history.length >= 15) { score += 10; reasons.push('long_track'); }

  const orbit = detectOrbit(history);
  if (orbit.isOrbit) { score += 20; reasons.push('orbit'); }

  return {
    type:       'ISR',
    score,
    confidence: parseFloat(Math.min(score / 105, 1).toFixed(2)),
    reasons,
    orbit,
  };
}

// ── Détection CAP (patrouille aérienne de combat) ────────────────────────────

/**
 * Basé uniquement sur le comportement — aucun type requis.
 * Score max : 100 pts
 *   orbit           : 40
 *   alt_stable      : 20
 *   speed_stable    : 20
 *   sustained_orbit : 20  (>= 20 min d'historique)
 */
function detectCAP(ac, history) {
  const orbit = detectOrbit(history);
  if (!orbit.isOrbit) return null;

  let score = 40;
  const reasons = ['orbit'];

  if (isAltStable(history))   { score += 20; reasons.push('alt_stable'); }
  if (isSpeedStable(history)) { score += 20; reasons.push('speed_stable'); }

  if (history.length >= 2) {
    const elapsed = history[history.length - 1].time - history[0].time;
    if (elapsed >= 20 * 60 * 1000) { score += 20; reasons.push('sustained_orbit'); }
  }

  return {
    type:       'CAP',
    score,
    confidence: parseFloat(Math.min(score / 100, 1).toFixed(2)),
    reasons,
    orbit,
  };
}

// ── Classificateur principal ──────────────────────────────────────────────────

/**
 * Retourne { activity, activity_confidence } pour un avion normalisé.
 * Priorité : AWACS > TANKER > ISR (type-driven) > CAP (behavior-only).
 *
 * @param {object} ac - avion normalisé (depuis military-aircraft.js)
 * @returns {{ activity: string|null, activity_confidence: number }}
 */
function classifyActivity(ac) {
  const history = trackHistory.get(ac.id) || [];

  // Détecteurs basés sur le type ICAO (plus fiables)
  const candidates = [
    detectAwacs(ac, history),
    detectTanker(ac, history),
    detectISR(ac, history),
  ].filter(Boolean);

  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => a.confidence > b.confidence ? a : b);
    if (best.confidence >= 0.5) {
      return { activity: best.type, activity_confidence: best.confidence };
    }
  }

  // Pas de type reconnu → détection comportementale (CAP uniquement)
  const cap = detectCAP(ac, history);
  if (cap && cap.confidence >= 0.5) {
    return { activity: cap.type, activity_confidence: cap.confidence };
  }

  return { activity: null, activity_confidence: 0 };
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  updateHistory,
  purgeHistory,
  classifyActivity,
  detectOrbit,   // exporté pour tests unitaires
};
