'use strict';

const { NAVAL_BASES, STRATEGIC_CHOKEPOINTS, MAJOR_PORTS, STRATEGIC_ZONES, MAJOR_SEA_LANES } = require('./data/maritime-context');
const { getMaritimeAnomaliesCache } = require('./maritime-anomalies');

const MARITIME_KEYWORDS = [
  'naval', 'warship', 'destroyer', 'frigate', 'corvette', 'submarine', 'carrier',
  'fleet', 'task force', 'task group', 'amphibious', 'minehunter', 'mine countermeasure',
  'strait', 'chokepoint', 'exclusive economic zone', 'eez', 'port visit', 'maritime',
  'south china sea', 'taiwan strait', 'hormuz', 'gibraltar', 'suez', 'bab el mandeb',
  'red sea', 'black sea', 'baltic sea', 'eastern mediterranean', 'freedom of navigation',
  'navy', 'coast guard', 'escort', 'blockade', 'transshipment', 'ship-to-ship', 'boarding',
  'offshore patrol', 'exercise at sea', 'naval exercise', 'maritime patrol'
];

const EVENT_TYPE_RULES = [
  { type: 'naval_exercise', weight: 28, terms: ['exercise', 'drill', 'maneuver', 'war game', 'task group'] },
  { type: 'fleet_deployment', weight: 24, terms: ['deployment', 'deployed', 'task force', 'carrier strike group', 'flotilla'] },
  { type: 'maritime_incident', weight: 26, terms: ['collision', 'incident at sea', 'intercepted', 'harassed', 'boarded', 'seized'] },
  { type: 'port_call', weight: 14, terms: ['port visit', 'arrived at port', 'docked', 'berthed'] },
  { type: 'chokepoint_tension', weight: 30, terms: ['strait', 'hormuz', 'gibraltar', 'bab-el-mandeb', 'suez', 'taiwan strait'] },
  { type: 'logistics_operation', weight: 20, terms: ['replenishment', 'resupply', 'transfer at sea', 'ship-to-ship', 'loitering'] },
];

const MARITIME_KEYWORD_WEIGHTS = new Map([
  ['naval', 8],
  ['warship', 12],
  ['destroyer', 10],
  ['frigate', 10],
  ['corvette', 10],
  ['submarine', 12],
  ['carrier', 10],
  ['fleet', 8],
  ['task force', 10],
  ['task group', 8],
  ['amphibious', 8],
  ['strait', 6],
  ['eez', 6],
  ['maritime', 5],
  ['south china sea', 9],
  ['taiwan strait', 10],
  ['hormuz', 10],
  ['gibraltar', 8],
  ['suez', 8],
  ['red sea', 8],
  ['black sea', 8],
  ['navy', 10],
  ['coast guard', 7],
  ['escort', 6],
  ['blockade', 10],
  ['transshipment', 8],
  ['ship-to-ship', 10],
  ['boarding', 8],
  ['naval exercise', 12],
  ['maritime patrol', 8],
]);

const MIN_MARITIME_SCORE = 28;
const RECENCY_HALF_LIFE_HOURS = 36;

function haversineKm(lat1, lon1, lat2, lon2) {
  const radiusKm = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeText(event) {
  return [
    event.title,
    event.titleFr,
    event.headline,
    event.notes,
    event.actor1,
    event.actor2,
    event.subType,
    event.subEventType,
    event.category,
    event.country,
    event.domain,
    event.url,
  ].filter(Boolean).join(' ').toLowerCase();
}

function extractMatchedKeywords(text) {
  const matches = [];
  for (const [term, weight] of MARITIME_KEYWORD_WEIGHTS.entries()) {
    if (text.includes(term)) matches.push({ term, weight });
  }
  return matches.sort((a, b) => b.weight - a.weight);
}

function scoreMaritimeRelevance(event, text) {
  const matches = extractMatchedKeywords(text);
  const keywordScore = matches.reduce((sum, item) => sum + item.weight, 0);
  const categoryBoost = maritimeCategoryBoost(event.category);
  const actorBoost = /navy|fleet|maritime|coast guard|destroyer|frigate|submarine/i.test(`${event.actor1 || ''} ${event.actor2 || ''}`)
    ? 8
    : 0;
  const subTypeBoost = /naval|maritime|blockade|exercise|deployment|intercept/i.test(`${event.subType || ''} ${event.subEventType || ''}`)
    ? 6
    : 0;

  return {
    score: keywordScore + categoryBoost + actorBoost + subTypeBoost,
    keywordScore,
    categoryBoost,
    actorBoost,
    subTypeBoost,
    matches,
  };
}

function pickNearest(lat, lon, features, maxDistanceKm) {
  let best = null;
  for (const feature of features) {
    const distanceKm = haversineKm(lat, lon, feature.lat, feature.lon);
    if (distanceKm > maxDistanceKm) continue;
    if (!best || distanceKm < best.distanceKm) {
      best = { ...feature, distanceKm: Math.round(distanceKm) };
    }
  }
  return best;
}

function pickZone(lat, lon, zones) {
  for (const zone of zones) {
    const distanceKm = haversineKm(lat, lon, zone.lat, zone.lon);
    if (distanceKm <= zone.radiusKm) {
      return { ...zone, distanceKm: Math.round(distanceKm) };
    }
  }
  return null;
}

function isMaritimeEvent(event) {
  if (!event || typeof event.lat !== 'number' || typeof event.lon !== 'number') return false;
  const text = normalizeText(event);
  const relevance = scoreMaritimeRelevance(event, text);
  if (relevance.score < MIN_MARITIME_SCORE) return false;
  // Require at least one maritime keyword OR location in a sensitive zone
  if (relevance.keywordScore === 0) {
    const ctx = buildContext(event);
    if (!ctx.sensitiveZone) return false;
  }
  return true;
}

function detectEventType(text) {
  let best = { type: 'maritime_activity', weight: 12 };
  const secondaryTags = [];
  for (const rule of EVENT_TYPE_RULES) {
    if (rule.terms.some(term => text.includes(term))) {
      secondaryTags.push(rule.type);
      if (rule.weight > best.weight) best = { type: rule.type, weight: rule.weight };
    }
  }
  return {
    primaryType: best.type,
    weight: best.weight,
    secondaryTags: [...new Set(secondaryTags.filter(tag => tag !== best.type))],
  };
}

function maritimeCategoryBoost(category) {
  switch (category) {
    case 'military': return 22;
    case 'strategic': return 18;
    case 'conflict': return 16;
    case 'crisis': return 14;
    case 'incident': return 10;
    default: return 6;
  }
}

function buildContext(event) {
  const nearestBase = pickNearest(event.lat, event.lon, NAVAL_BASES, 450);
  const nearestChokepoint = pickNearest(event.lat, event.lon, STRATEGIC_CHOKEPOINTS, 300);
  const nearestPort = pickNearest(event.lat, event.lon, MAJOR_PORTS, 175);
  const strategicZone = pickZone(event.lat, event.lon, STRATEGIC_ZONES);
  const nearestSeaLane = pickNearest(event.lat, event.lon, MAJOR_SEA_LANES, 320);
  const contextTags = [];

  if (nearestBase) contextTags.push('near_naval_base');
  if (nearestChokepoint) contextTags.push('near_chokepoint');
  if (nearestPort) contextTags.push('near_major_port');
  if (strategicZone) contextTags.push('inside_strategic_zone');
  if (nearestSeaLane) contextTags.push('near_major_sea_lane');

  return {
    nearestBase,
    nearestChokepoint,
    nearestPort,
    strategicZone,
    nearestSeaLane,
    contextTags,
    sensitiveZone: Boolean(nearestBase || nearestChokepoint || strategicZone),
  };
}

function summarizeSignal(eventType, event, context) {
  const parts = [];
  if (event.titleFr) parts.push(event.titleFr);
  else if (event.headline) parts.push(event.headline);
  else parts.push(event.title);

  if (context.nearestChokepoint) {
    parts.push(`proche de ${context.nearestChokepoint.name}`);
  } else if (context.nearestBase) {
    parts.push(`proche de ${context.nearestBase.name}`);
  } else if (context.strategicZone) {
    parts.push(`dans ${context.strategicZone.name}`);
  } else if (context.nearestPort) {
    parts.push(`près de ${context.nearestPort.name}`);
  }

  return `${eventType.replace(/_/g, ' ')} — ${parts.filter(Boolean).join(' | ')}`.slice(0, 280);
}

function toMaritimeSignal(event) {
  const text = normalizeText(event);
  const detected = detectEventType(text);
  const maritime = scoreMaritimeRelevance(event, text);
  const context = buildContext(event);

  let confidence = detected.weight + maritime.keywordScore + maritime.categoryBoost;
  if (context.nearestBase) confidence += 18;
  if (context.nearestChokepoint) confidence += 16;
  if (context.nearestPort) confidence += 8;
  if (context.strategicZone) confidence += 12;
  if (context.nearestSeaLane) confidence += 6;
  confidence += maritime.actorBoost + maritime.subTypeBoost;

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    id: `maritime-${event.id}`,
    sourceEventId: event.id,
    latitude: event.lat,
    longitude: event.lon,
    type: detected.primaryType,
    tags: detected.secondaryTags,
    maritimeScore: maritime.score,
    confidenceScore: confidence,
    timestamp: event.date || event.lastUpdate || new Date().toISOString(),
    title: event.title,
    titleFr: event.titleFr || null,
    category: event.category,
    country: event.country,
    context,
    description: summarizeSignal(detected.primaryType, event, context),
    provenance: {
      gdelt: {
        eventId: event.id,
        category: event.category,
        domain: event.domain || null,
        url: event.url || null,
        maritimeScore: maritime.score,
        keywordScore: maritime.keywordScore,
        matchedKeywords: maritime.matches.map(item => item.term),
        typeWeight: detected.weight,
        secondaryTags: detected.secondaryTags,
      },
      maritimeContext: {
        enabled: Boolean(context.nearestBase || context.nearestChokepoint || context.nearestPort || context.strategicZone || context.nearestSeaLane),
        contextTags: context.contextTags,
      },
      anomalySources: [],
      anomalyCount: 0,
    },
    rawEvent: {
      url: event.url,
      domain: event.domain || null,
      actor1: event.actor1 || null,
      actor2: event.actor2 || null,
      notes: event.notes || null,
      headline: event.headline || null,
    },
  };
}

function contextualizeAnomaly(anomaly) {
  const context = buildContext({ lat: anomaly.lat, lon: anomaly.lon });
  return {
    ...anomaly,
    latitude: anomaly.lat,
    longitude: anomaly.lon,
    provenance: {
      anomalySource: anomaly.source,
      maritimeContext: {
        enabled: Boolean(context.nearestBase || context.nearestChokepoint || context.strategicZone),
        contextTags: context.contextTags,
      },
    },
    context,
  };
}

function getMaritimeEvents(events = []) {
  return events
    .filter(isMaritimeEvent)
    .map(toMaritimeSignal)
    .sort((a, b) => b.confidenceScore - a.confidenceScore);
}

function getMaritimeAnomalies() {
  const cache = getMaritimeAnomaliesCache();
  return {
    anomalies: (cache.anomalies || []).map(contextualizeAnomaly),
    meta: {
      status: cache.status,
      sources: [cache.source || 'GlobalFishingWatch'],
      message: cache.status === 'not_configured'
        ? 'Connecteur anomalies maritimes non configure.'
        : (cache.error || null),
      generatedAt: new Date().toISOString(),
      lastUpdate: cache.lastUpdate,
    },
  };
}

function correlateAnomalies(signal, anomalies, maxDistanceKm = 220) {
  return anomalies
    .map(anomaly => ({
      ...anomaly,
      distanceKm: Math.round(haversineKm(signal.latitude, signal.longitude, anomaly.latitude, anomaly.longitude)),
      fusionBonus: computeAnomalyFusionBonus(signal, anomaly, maxDistanceKm),
    }))
    .filter(anomaly => anomaly.distanceKm <= maxDistanceKm && anomaly.fusionBonus > 0)
    .sort((a, b) => b.fusionBonus - a.fusionBonus || a.distanceKm - b.distanceKm)
    .slice(0, 3);
}

function computeRecencyPenalty(timestamp) {
  const parsed = Date.parse(timestamp || '');
  if (!Number.isFinite(parsed)) return 0;
  const ageHours = Math.max(0, (Date.now() - parsed) / 3600000);
  if (ageHours <= 6) return 0;
  const penalty = Math.log2(1 + ageHours / RECENCY_HALF_LIFE_HOURS) * 10;
  return Math.max(0, Math.min(24, Math.round(penalty)));
}

function computeAnomalyFusionBonus(signal, anomaly, maxDistanceKm) {
  const distanceKm = haversineKm(signal.latitude, signal.longitude, anomaly.latitude, anomaly.longitude);
  if (distanceKm > maxDistanceKm) return 0;

  const confidence = Math.max(0, Math.min(100, Number(anomaly.confidenceScore || 50)));
  const distanceFactor = Math.max(0, 1 - (distanceKm / maxDistanceKm));
  const confidenceFactor = confidence / 100;
  const contextFactor = anomaly.context?.sensitiveZone ? 1.15 : 1;
  return Math.round(18 * distanceFactor * confidenceFactor * contextFactor);
}

function getNavalActivity(events = []) {
  const maritimeEvents = getMaritimeEvents(events);
  const anomalies = getMaritimeAnomalies();

  const activity = maritimeEvents.map(signal => {
    const nearbyAnomalies = correlateAnomalies(signal, anomalies.anomalies);
    const anomalyBonus = nearbyAnomalies.reduce((sum, item) => sum + item.fusionBonus, 0);
    const recencyPenalty = computeRecencyPenalty(signal.timestamp);
    const boostedScore = Math.max(0, Math.min(100, signal.confidenceScore + anomalyBonus - recencyPenalty));
    const anomalySources = [...new Set(nearbyAnomalies.map(item => item.source).filter(Boolean))];
    return {
      ...signal,
      confidenceScore: boostedScore,
      nearbyAnomalies,
      scoreBreakdown: {
        baseConfidence: signal.confidenceScore,
        anomalyBonus,
        recencyPenalty,
        finalConfidence: boostedScore,
      },
      activityClass:
        boostedScore >= 75 ? 'probable_naval_activity' :
        boostedScore >= 55 ? 'possible_naval_activity' :
        'weak_signal',
      provenance: {
        ...signal.provenance,
        anomalySources,
        anomalyCount: nearbyAnomalies.length,
      },
    };
  });

  return {
    events: activity,
    anomalies: anomalies.anomalies,
    meta: {
      generatedAt: new Date().toISOString(),
      count: activity.length,
      anomalyStatus: anomalies.meta.status,
      sourceBreakdown: {
        gdelt: activity.length,
        maritimeContext: activity.filter(item => item.provenance?.maritimeContext?.enabled).length,
        anomalies: anomalies.anomalies.length,
      },
    },
  };
}

module.exports = {
  getMaritimeEvents,
  getMaritimeAnomalies,
  getNavalActivity,
};