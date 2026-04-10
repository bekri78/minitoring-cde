'use strict';

const { MILITARY_AIRBASES } = require('./data/military-airbases');

// ── Event type rules ──────────────────────────────────────────────────────────
const EVENT_TYPE_RULES = [
  { type: 'air_strike',            weight: 35, terms: ['airstrike', 'air strike', 'bombing run', 'targeted strike', 'precision strike', 'air attack', 'bombed', 'bomb drop'] },
  { type: 'air_interception',      weight: 32, terms: ['intercept', 'intercepted', 'scrambled', 'scramble', 'shadowed', 'buzzed', 'close approach', 'unsafe intercept', 'dangerous intercept', 'fighter jets scrambled'] },
  { type: 'air_patrol',            weight: 20, terms: ['air patrol', 'patrol aircraft', 'surveillance flight', 'reconnaissance flight', 'isr', 'awacs', 'overwatch', 'istar'] },
  { type: 'airspace_closure',      weight: 28, terms: ['airspace closed', 'notam', 'no-fly zone', 'flight restriction', 'temporary flight restriction', 'tfr', 'closed airspace', 'airspace violated'] },
  { type: 'air_exercise',          weight: 18, terms: ['air exercise', 'flying exercise', 'combat training', 'red flag', 'pitch black', 'tiger meet', 'joint air exercise', 'combined air exercise'] },
  { type: 'drone_operation',       weight: 26, terms: ['drone', 'uav', 'unmanned aerial', 'rpas', 'shaheed', 'shahed', 'loitering munition', 'kamikaze drone', 'fpv drone', 'bayraktar', 'switchblade'] },
  { type: 'air_defense_engagement',weight: 34, terms: ['shot down', 'downed aircraft', 'air defense', 's-400', 's-300', 'patriot system', 'thaad', 'surface-to-air', 'anti-aircraft', 'air defense activated', 'iron dome activated'] },
  { type: 'air_deployment',        weight: 22, terms: ['air deployment', 'deployed aircraft', 'forward deployed', 'rotational deployment', 'air reinforcements', 'aircraft deployed'] },
  { type: 'air_incident',          weight: 24, terms: ['aircraft crash', 'near miss', 'near-miss', 'emergency landing', 'mayday', 'aviation incident', 'aircraft incident', 'midair'] },
];

// ── Keyword weights ────────────────────────────────────────────────────────────
const AVIATION_KEYWORD_WEIGHTS = new Map([
  // Platforms
  ['fighter', 10], ['bomber', 12], ['f-16', 11], ['f-35', 11], ['f-22', 11],
  ['su-35', 11], ['su-57', 12], ['su-24', 10], ['su-25', 10],
  ['b-52', 12], ['b-2', 12], ['b-21', 13], ['tu-160', 12], ['tu-95', 12],
  ['p-8', 10], ['mq-9', 10], ['rq-4', 10], ['global hawk', 10], ['predator drone', 9], ['reaper', 9],
  ['u-2', 10], ['rc-135', 11], ['awacs', 11], ['rivet joint', 10],
  ['typhoon', 8], ['rafale', 8], ['eurofighter', 8],
  ['a-10', 9], ['ac-130', 10], ['ah-64', 9], ['apache helicopter', 8],
  // Actions / events
  ['scrambled', 12], ['intercept', 11], ['interception', 11],
  ['airstrike', 14], ['air strike', 14], ['sortie', 10],
  ['overfly', 9], ['overflight', 10], ['penetrat', 9],
  ['shot down', 14], ['downed', 12], ['neutralized aircraft', 9],
  // Domains
  ['air force', 9], ['air base', 8], ['airbase', 8], ['air wing', 8], ['squadron', 8],
  ['drone', 9], ['uav', 10], ['shaheed', 11], ['shahed', 11], ['bayraktar', 10],
  ['no-fly zone', 10], ['notam', 8], ['airspace', 7], ['restricted airspace', 9],
  ['air defense', 10], ['s-400', 10], ['patriot', 9], ['iron dome', 10],
  ['close air support', 10], ['air superiority', 9], ['air supremacy', 9],
]);

// ── Contradiction penalties — dilute signal for non-operational content ────────
const CONTRADICTION_PATTERNS = [
  { pattern: /\bopinion\b|\bop-ed\b|\bcommentary\b|\banalysis\b/i,                           penalty: 12, label: 'opinion_content' },
  { pattern: /\bforecast\b|\bprediction\b|\bscenario\b/i,                                    penalty: 10, label: 'speculative_content' },
  { pattern: /\bhistorical\b|\bdecades ago\b|\byears ago\b|\bduring world war\b/i,            penalty: 14, label: 'historical_content' },
  { pattern: /\bcontract\b.*\baircraft\b|\bprocurement\b|\border\b.*\bjet\b|\bdelivery\b.*\bjet\b/i, penalty: 10, label: 'procurement_content' },
  { pattern: /\bthink tank\b|\bpolicy paper\b|\bwhite paper\b|\bstrategic review\b/i,         penalty: 12, label: 'doctrinal_content' },
  { pattern: /\bsimulat|\bwargame\b|\btabletop\b|\bscenario planning\b/i,                     penalty: 8,  label: 'simulated_content' },
  { pattern: /\bindus trial contract\b|\bdefense industry\b|\bmanufactur.*aircraft\b/i,        penalty: 8,  label: 'industrial_content' },
];

// ── Action verbs — evidence of operational reality ────────────────────────────
const ACTION_VERB_PATTERNS = [
  { pattern: /\bstruck\b|\bbombed\b|\bhit\b.{0,40}\btarget\b|\battacked\b/i,    score: 16 },
  { pattern: /\bscrambled\b|\bdispatched\b|\bdeployed\b.{0,30}\baircraf/i,      score: 12 },
  { pattern: /\bintercepted\b|\bshadowed\b|\bescorted\b|\btracked\b/i,          score: 12 },
  { pattern: /\bdowned\b|\bshot down\b|\bdestroyed\b.{0,30}\baircraf/i,         score: 16 },
  { pattern: /\bcrossed into\b|\bentered\b.{0,30}\bairspace\b|\bviolated\b.{0,30}\bairspace\b/i, score: 14 },
  { pattern: /\bactivated\b.{0,30}\bair defense\b|\bfired\b.{0,20}\bmissile\b/i, score: 14 },
  { pattern: /\bcrashed\b|\bwent down\b|\bmayday\b/i,                           score: 10 },
  { pattern: /\boverflew\b|\bconducted\b.{0,30}\boverflight\b/i,                score: 10 },
];

const MIN_AVIATION_SCORE = 22;
const RECENCY_HALF_LIFE_HOURS = 36;

// ── OpenSky cache (populated by cron, read-only during requests) ──────────────
let openSkyCache = { aircraft: [], lastUpdate: null, status: 'not_loaded' };

function getOpenSkyCache() { return openSkyCache; }

async function refreshOpenSkyCache() {
  // Free tier: no auth, global snapshot, rate-limited — call max every 15min
  const url = 'https://opensky-network.org/api/states/all';
  try {
    console.log('[opensky] refreshing aircraft cache...');
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(25000),
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      console.warn(`[opensky] HTTP ${resp.status}`);
      openSkyCache = { ...openSkyCache, status: `error_http_${resp.status}` };
      return;
    }
    const data = await resp.json();
    const states = Array.isArray(data?.states) ? data.states : [];
    openSkyCache = {
      aircraft: states
        .map(s => ({
          icao24:   s[0],
          callsign: (s[1] || '').trim(),
          lat:      s[6],
          lon:      s[5],
          altBaro:  s[7],
          velocity: s[9],
          onGround: s[8],
        }))
        .filter(a => typeof a.lat === 'number' && typeof a.lon === 'number'),
      lastUpdate: new Date().toISOString(),
      status: 'ok',
    };
    console.log(`[opensky] cached ${openSkyCache.aircraft.length} aircraft`);
  } catch (err) {
    console.warn('[opensky] refresh failed:', err.message);
    openSkyCache = { ...openSkyCache, status: 'error' };
  }
}

// ── Geo helpers ───────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pickNearest(lat, lon, features, maxKm) {
  let best = null;
  for (const f of features) {
    const d = haversineKm(lat, lon, f.lat, f.lon);
    if (d <= maxKm && (!best || d < best.distanceKm)) {
      best = { ...f, distanceKm: Math.round(d) };
    }
  }
  return best;
}

// ── Scoring helpers ───────────────────────────────────────────────────────────
function normalizeText(event) {
  return [
    event.title, event.titleFr, event.headline, event.notes,
    event.actor1, event.actor2, event.subType, event.subEventType,
    event.category, event.country, event.domain, event.url,
  ].filter(Boolean).join(' ').toLowerCase();
}

function extractKeywordScore(text) {
  let score = 0;
  const matched = [];
  for (const [term, weight] of AVIATION_KEYWORD_WEIGHTS.entries()) {
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
      found.push(pattern.source.split('\\b')[1] || 'action');
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
  let best = { type: 'aviation_activity', weight: 10 };
  const secondary = [];
  for (const rule of EVENT_TYPE_RULES) {
    if (rule.terms.some(term => text.includes(term))) {
      secondary.push(rule.type);
      if (rule.weight > best.weight) best = { type: rule.type, weight: rule.weight };
    }
  }
  return { primaryType: best.type, weight: best.weight, secondaryTags: [...new Set(secondary.filter(t => t !== best.type))] };
}

function aviationCategoryBoost(category) {
  switch (category) {
    case 'military':  return 22;
    case 'strategic': return 18;
    case 'conflict':  return 16;
    case 'crisis':    return 14;
    case 'incident':  return 10;
    default:          return 4;
  }
}

function buildGeoContext(event) {
  const nearestBase = pickNearest(event.lat, event.lon, MILITARY_AIRBASES, 400);
  const contextTags = [];
  if (nearestBase) contextTags.push('near_airbase');
  return { nearestBase, contextTags, sensitiveZone: Boolean(nearestBase) };
}

function computeGeoContextScore(context) {
  if (!context.nearestBase) return 0;
  const d = context.nearestBase.distanceKm;
  return d < 100 ? 18 : d < 200 ? 12 : d < 400 ? 6 : 0;
}

function computeRecencyScore(timestamp) {
  const parsed = Date.parse(timestamp || '');
  if (!Number.isFinite(parsed)) return 0;
  const ageHours = Math.max(0, (Date.now() - parsed) / 3600000);
  if (ageHours <= 6)  return 8;
  if (ageHours <= 24) return 4;
  return 0;
}

// ── OpenSky corroboration (cache-first, absence ≠ proof of nothing) ───────────
function correlateOpenSky(lat, lon, radiusKm = 250) {
  if (!openSkyCache.lastUpdate) {
    return { source: 'opensky', status: 'not_observable', confidenceImpact: 0, count: 0 };
  }
  const nearby = openSkyCache.aircraft.filter(
    a => haversineKm(lat, lon, a.lat, a.lon) <= radiusKm
  );
  if (nearby.length > 0) {
    return { source: 'opensky', status: 'matched', confidenceImpact: 8, count: nearby.length };
  }
  // Absence of ADS-B is WEAK evidence — many military aircraft don't squawk
  return { source: 'opensky', status: 'not_found', confidenceImpact: -2, count: 0 };
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
function isAviationEvent(event) {
  if (!event || typeof event.lat !== 'number' || typeof event.lon !== 'number') return false;
  const text = normalizeText(event);
  const { keywordScore } = extractKeywordScore(text);
  return keywordScore >= MIN_AVIATION_SCORE;
}

// ── Build description ─────────────────────────────────────────────────────────
function buildDescription(type, event, context) {
  const title = event.titleFr || event.headline || event.title || '';
  const geo   = context.nearestBase ? `proche de ${context.nearestBase.name}` : (event.country || '');
  return `${type.replace(/_/g, ' ')} — ${[title, geo].filter(Boolean).join(' | ')}`.slice(0, 280);
}

// ── Main transform ────────────────────────────────────────────────────────────
function toAviationSignal(event) {
  const text = normalizeText(event);

  const detected             = detectEventType(text);
  const { keywordScore, matchedKeywords } = extractKeywordScore(text);
  const { actionVerbScore, verbsFound }   = detectActionVerbs(text);
  const { contradictionPenalty, contradictionLabels } = applyContradictionPenalties(text);

  const eventTypeScore   = detected.weight;
  const catBoost         = aviationCategoryBoost(event.category);
  const context          = buildGeoContext(event);
  const geoContextScore  = computeGeoContextScore(context);
  const recencyScore     = computeRecencyScore(event.date || event.lastUpdate);
  const corroboration    = correlateOpenSky(event.lat, event.lon);
  const corroborationScore = Math.max(0, corroboration.confidenceImpact);

  const raw            = keywordScore + eventTypeScore + actionVerbScore + catBoost + geoContextScore + recencyScore + corroborationScore;
  const finalConfidence = Math.max(0, Math.min(100, raw - contradictionPenalty));

  const eventRealityLevel = determineEventRealityLevel(keywordScore, actionVerbScore, contradictionPenalty, corroborationScore);

  const activityClass =
    finalConfidence >= 75 ? 'probable_air_activity' :
    finalConfidence >= 50 ? 'possible_air_activity' : 'weak_signal';

  return {
    id:                `aviation-${event.id}`,
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
    description:       buildDescription(detected.primaryType, event, context),
    context: {
      nearestBase:  context.nearestBase,
      sensitiveZone: context.sensitiveZone,
      contextTags:  context.contextTags,
    },
    scoreBreakdown: {
      keywordScore,
      eventTypeScore,
      actionVerbScore,
      recencyScore,
      geoContextScore,
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
function getAviationEvents(events = []) {
  return events
    .filter(isAviationEvent)
    .map(toAviationSignal)
    .sort((a, b) => b.confidenceScore - a.confidenceScore);
}

module.exports = {
  getAviationEvents,
  refreshOpenSkyCache,
  getOpenSkyCache,
};
