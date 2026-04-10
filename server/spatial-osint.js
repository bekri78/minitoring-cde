'use strict';

// Space-Track cache is populated by the existing spacetrack.js cron jobs.
// This module reads it — it never calls Space-Track directly during requests.
const { getCache: getSpaceTrackCache, getTipCache } = require('./spacetrack');

// ── Event type rules ──────────────────────────────────────────────────────────
const EVENT_TYPE_RULES = [
  { type: 'military_launch',       weight: 35, terms: ['military satellite', 'reconnaissance satellite', 'spy satellite', 'military launch', 'armed forces satellite', 'defense satellite', 'national security satellite', 'classified payload', 'classified satellite', 'plassf', 'pla strategic support force'] },
  { type: 'asat_indicator',        weight: 36, terms: ['asat', 'anti-satellite', 'direct ascent', 'co-orbital', 'space weapon', 'kill vehicle', 'space-based weapon', 'counter-space', 'antisatellite'] },
  { type: 'orbital_weapon_signal', weight: 36, terms: ['fractional orbital', 'fobs', 'orbital bomb', 'orbital weapon', 'space-based weapon', 'counter-space weapon'] },
  { type: 'gps_jamming',           weight: 30, terms: ['gps jamming', 'gps spoofing', 'gnss jamming', 'gnss spoofing', 'navigation jamming', 'signal jamming', 'electronic warfare gps', 'gps denied'] },
  { type: 'space_incident',        weight: 28, terms: ['satellite collision', 'space debris', 'orbital debris', 'fragmentation event', 'satellite failure', 'anomaly in orbit', 'orbital anomaly'] },
  { type: 'reentry_risk',          weight: 26, terms: ['reentry', 're-entry', 'uncontrolled reentry', 'space debris impact', 'orbital decay', 'deorbit', 'decaying orbit'] },
  { type: 'space_surveillance',    weight: 24, terms: ['space domain awareness', 'space situational awareness', 'ssa', 'sda', 'space object tracking', 'orbital tracking', 'space tracking'] },
  { type: 'space_exercise',        weight: 20, terms: ['space exercise', 'space war game', 'orbital exercise', 'space domain awareness exercise', 'schriever wargame'] },
  { type: 'satellite_operation',   weight: 18, terms: ['satellite', 'orbital', 'orbit', 'geostationary', 'maneuvering satellite', 'inspector satellite', 'rendezvous operation', 'proximity operation'] },
];

// ── Keyword weights ────────────────────────────────────────────────────────────
const SPATIAL_KEYWORD_WEIGHTS = new Map([
  // High-threat indicators
  ['asat', 16], ['anti-satellite', 16], ['space weapon', 14], ['counter-space', 12],
  ['fractional orbital', 16], ['fobs', 16], ['orbital weapon', 16], ['orbital bomb', 16],
  ['co-orbital', 12], ['kill vehicle', 14],
  // Military space actors
  ['space force', 9], ['space command', 9], ['plassf', 14], ['pla strategic support force', 14],
  ['space domain', 8], ['space domain awareness', 10], ['space situational awareness', 10],
  // GPS/Navigation warfare
  ['gps jamming', 14], ['gps spoofing', 14], ['gnss jamming', 12], ['gnss spoofing', 12],
  ['gps denied', 10], ['navigation jamming', 10],
  // Platforms & programs
  ['military satellite', 14], ['spy satellite', 14], ['reconnaissance satellite', 14],
  ['classified payload', 14], ['national security satellite', 12], ['defense satellite', 10],
  ['x-37', 12], ['x-37b', 12], ['spaceplane', 10],
  ['norad', 8], ['sda', 7], ['ssa', 7],
  // Operations
  ['satellite', 8], ['orbital', 8], ['orbit', 6], ['launch vehicle', 10], ['rocket launch', 10],
  ['reentry', 8], ['deorbit', 8], ['debris field', 8],
  ['maneuvering satellite', 12], ['inspector satellite', 12],
  ['rendezvous', 10], ['proximity operation', 12],
  ['hypersonic', 10], ['ballistic missile', 10],
]);

// ── Contradiction penalties ────────────────────────────────────────────────────
const CONTRADICTION_PATTERNS = [
  { pattern: /\bopinion\b|\bop-ed\b|\bcommentary\b/i,                                             penalty: 12, label: 'opinion_content' },
  { pattern: /\bforecast\b|\bprojection\b|\blong-term plan\b/i,                                   penalty: 10, label: 'speculative_content' },
  { pattern: /\bhistorical\b|\bspace race\b.{0,20}\b196|\blegacy\b.{0,20}\bspace program\b/i,     penalty: 12, label: 'historical_content' },
  { pattern: /\bcommercial satellite\b|\bbroadcast satellite\b|\bcommunications satellite\b(?!.*military)/i, penalty: 8, label: 'commercial_content' },
  { pattern: /\bscience\b.{0,20}\bmission\b|\bscientific\b.{0,20}\bsatellite\b|\btelescope\b/i,  penalty: 10, label: 'civilian_science' },
  { pattern: /\bcontract\b|\bprocurement\b|\bindustrial\b|\bmanufactur/i,                          penalty: 8,  label: 'procurement_content' },
  { pattern: /\bspace policy\b|\bspace law\b|\bouterspace treaty\b|\bspace governance\b/i,         penalty: 10, label: 'policy_content' },
];

// ── Action verbs ──────────────────────────────────────────────────────────────
const ACTION_VERB_PATTERNS = [
  { pattern: /\blaunched\b.{0,30}\b(satellite|rocket|missile|vehicle)\b/i,    score: 16 },
  { pattern: /\bdetected\b.{0,30}\b(satellite|object|launch|debris)\b/i,      score: 12 },
  { pattern: /\bjammed\b|\bspoofed\b|\binterfer.{0,15}\bsignal\b/i,           score: 14 },
  { pattern: /\bdestroyed\b.{0,20}\bsatellite\b|\basat\b.{0,20}\btest\b/i,    score: 18 },
  { pattern: /\breentered\b|\bdeorbited\b|\bfell.{0,20}\bearth\b|\bimpact\b.{0,20}\bdebris\b/i, score: 12 },
  { pattern: /\bmaneuver\b|\brendezvous\b|\bproximity operation\b/i,           score: 14 },
  { pattern: /\bnew object\b|\bunknown object\b|\bunexplained\b.{0,20}\borbit\b/i, score: 12 },
  { pattern: /\bactivated\b|\bdeployed\b.{0,20}\b(satellite|system)\b/i,      score: 10 },
];

const MIN_SPATIAL_SCORE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeText(event) {
  return [
    event.title, event.titleFr, event.headline, event.notes,
    event.actor1, event.actor2, event.subType, event.subEventType,
    event.category, event.country, event.domain,
  ].filter(Boolean).join(' ').toLowerCase();
}

function extractKeywordScore(text) {
  let score = 0;
  const matched = [];
  for (const [term, weight] of SPATIAL_KEYWORD_WEIGHTS.entries()) {
    if (text.includes(term)) { score += weight; matched.push(term); }
  }
  return { keywordScore: score, matchedKeywords: matched };
}

function detectActionVerbs(text) {
  let score = 0;
  const found = [];
  for (const { pattern, score: s } of ACTION_VERB_PATTERNS) {
    if (pattern.test(text)) {
      score += s;
      found.push(pattern.source.slice(0, 40).replace(/\\/g, ''));
    }
  }
  return { actionVerbScore: Math.min(score, 32), verbsFound: found };
}

function applyContradictionPenalties(text) {
  let penalty = 0;
  const labels = [];
  for (const { pattern, penalty: p, label } of CONTRADICTION_PATTERNS) {
    if (pattern.test(text)) { penalty += p; labels.push(label); }
  }
  return { contradictionPenalty: Math.min(penalty, 40), contradictionLabels: labels };
}

function detectEventType(text) {
  let best = { type: 'space_activity', weight: 8 };
  const secondary = [];
  for (const rule of EVENT_TYPE_RULES) {
    if (rule.terms.some(t => text.includes(t))) {
      secondary.push(rule.type);
      if (rule.weight > best.weight) best = { type: rule.type, weight: rule.weight };
    }
  }
  return { primaryType: best.type, weight: best.weight, secondaryTags: [...new Set(secondary.filter(t => t !== best.type))] };
}

function spatialCategoryBoost(category) {
  switch (category) {
    case 'military':  return 20;
    case 'strategic': return 16;
    case 'conflict':  return 12;
    case 'crisis':    return 10;
    default:          return 4;
  }
}

function computeRecencyScore(timestamp) {
  const parsed = Date.parse(timestamp || '');
  if (!Number.isFinite(parsed)) return 0;
  const ageHours = Math.max(0, (Date.now() - parsed) / 3600000);
  if (ageHours <= 6)  return 10;
  if (ageHours <= 24) return 5;
  return 0;
}

// ── Space-Track corroboration (read cache, no API call) ───────────────────────
function correlateSpaceTrack(event, text) {
  const stCache  = getSpaceTrackCache();
  const tipCache = getTipCache();

  if (!stCache.lastUpdate && !tipCache.lastUpdate) {
    return { source: 'spacetrack', status: 'not_configured', confidenceImpact: 0 };
  }

  // High-interest TIP objects are always a soft corroboration signal
  const highInterestTip = (tipCache.objects || []).filter(o => o.highInterest).length;

  // Try to match DECAY/TIP object by country code (2-char event country vs COUNTRY_CODE)
  const eventCountrySlug = (event.country || '').toLowerCase().slice(0, 3);
  const matchedObjects = (stCache.objects || []).filter(o => {
    const objName = (o.name || '').toLowerCase();
    return objName && text.includes(objName.slice(0, 6));
  });

  if (matchedObjects.length > 0) {
    return { source: 'spacetrack', status: 'matched', confidenceImpact: 14, matchedObjects: matchedObjects.length };
  }
  if (highInterestTip > 0) {
    return { source: 'spacetrack', status: 'high_interest_tip', confidenceImpact: 6, highInterestObjects: highInterestTip };
  }
  return { source: 'spacetrack', status: 'not_found', confidenceImpact: 0 };
}

// ── eventRealityLevel ─────────────────────────────────────────────────────────
function determineEventRealityLevel(keywordScore, actionVerbScore, contradictionPenalty, corroborationScore) {
  const isOperational = actionVerbScore >= 10 || keywordScore >= 22;
  if (contradictionPenalty >= 20 && !isOperational) return 'topic';
  if (corroborationScore > 0)                        return 'corroborated_activity';
  if (isOperational)                                 return 'operational_signal';
  return 'topic';
}

// ── Filter ────────────────────────────────────────────────────────────────────
function isSpatialEvent(event) {
  if (!event || typeof event.lat !== 'number' || typeof event.lon !== 'number') return false;
  const text = normalizeText(event);
  const { keywordScore } = extractKeywordScore(text);
  return keywordScore >= MIN_SPATIAL_SCORE;
}

// ── Main transform ────────────────────────────────────────────────────────────
function toSpatialSignal(event) {
  const text = normalizeText(event);

  const detected             = detectEventType(text);
  const { keywordScore, matchedKeywords } = extractKeywordScore(text);
  const { actionVerbScore, verbsFound }   = detectActionVerbs(text);
  const { contradictionPenalty, contradictionLabels } = applyContradictionPenalties(text);

  const eventTypeScore     = detected.weight;
  const catBoost           = spatialCategoryBoost(event.category);
  const recencyScore       = computeRecencyScore(event.date || event.lastUpdate);
  const corroboration      = correlateSpaceTrack(event, text);
  const corroborationScore = Math.max(0, corroboration.confidenceImpact);

  const raw             = keywordScore + eventTypeScore + actionVerbScore + catBoost + recencyScore + corroborationScore;
  const finalConfidence = Math.max(0, Math.min(100, raw - contradictionPenalty));

  const eventRealityLevel = determineEventRealityLevel(keywordScore, actionVerbScore, contradictionPenalty, corroborationScore);

  const activityClass =
    finalConfidence >= 75 ? 'probable_space_activity' :
    finalConfidence >= 50 ? 'possible_space_activity' : 'weak_signal';

  return {
    id:                `spatial-${event.id}`,
    latitude:          event.lat,
    longitude:         event.lon,
    type:              detected.primaryType,
    tags:              detected.secondaryTags,
    confidenceScore:   finalConfidence,
    activityClass,
    eventRealityLevel,
    timestamp:         event.date || event.lastUpdate || new Date().toISOString(),
    title:             event.title,
    titleFr:           event.titleFr || null,
    country:           event.country,
    category:          event.category,
    description:       `${detected.primaryType.replace(/_/g, ' ')} — ${event.titleFr || event.headline || event.title || ''}`.slice(0, 280),
    context: {
      nearestBase:   null,
      sensitiveZone: false,
      contextTags:   [],
    },
    scoreBreakdown: {
      keywordScore,
      eventTypeScore,
      actionVerbScore,
      recencyScore,
      geoContextScore:     0,
      corroborationScore,
      contradictionPenalty,
      finalConfidence,
    },
    provenance: {
      gdelt: {
        eventId:          event.id,
        category:         event.category,
        domain:           event.domain || null,
        url:              event.url || null,
        matchedKeywords,
        verbsFound,
        contradictionLabels,
        secondaryTags:    detected.secondaryTags,
      },
      corroboration,
    },
    rawEvent: {
      url:      event.url,
      domain:   event.domain || null,
      actor1:   event.actor1 || null,
      actor2:   event.actor2 || null,
      notes:    event.notes || null,
      headline: event.headline || null,
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────
function getSpatialEvents(events = []) {
  return events
    .filter(isSpatialEvent)
    .map(toSpatialSignal)
    .sort((a, b) => b.confidenceScore - a.confidenceScore);
}

module.exports = { getSpatialEvents };
