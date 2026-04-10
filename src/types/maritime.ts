export interface MaritimeAnomaly {
  id:              string;
  type:            string;       // dark_shipping, loitering, vessel_encounter, fishing_activity…
  lat:             number;
  lon:             number;
  timestamp:       string;
  confidenceScore: number;
  source:          string;
  vesselId:        string | null;
  details: {
    gfwType:     string;
    vessel:      { name: string | null; flag: string | null; type: string | null } | null;
    durationMin: number | null;
    regions:     Record<string, unknown> | null;
  };
  context: {
    nearestBase:       { name: string; country: string; distanceKm: number } | null;
    nearestChokepoint: { name: string; distanceKm: number } | null;
    nearestPort:       { name: string; distanceKm: number } | null;
    strategicZone:     { name: string; distanceKm: number } | null;
    nearestSeaLane:    { name: string; distanceKm: number } | null;
    contextTags:       string[];
    sensitiveZone:     boolean;
  };
}

export interface NavalEvent {
  id:              string;
  sourceEventId:   string;
  latitude:        number;
  longitude:       number;
  type:            string;   // naval_exercise, fleet_deployment, maritime_incident, chokepoint_tension…
  tags:            string[];
  confidenceScore: number;
  maritimeScore:   number;
  timestamp:       string;
  title:           string;
  titleFr:         string | null;
  category:        string;
  country:         string;
  description:     string;
  activityClass:   'probable_naval_activity' | 'possible_naval_activity' | 'weak_signal';
  context: {
    nearestBase:       { name: string; country: string; distanceKm: number } | null;
    nearestChokepoint: { name: string; distanceKm: number } | null;
    nearestPort:       { name: string; distanceKm: number } | null;
    strategicZone:     { name: string; distanceKm: number } | null;
    nearestSeaLane:    { name: string; distanceKm: number } | null;
    contextTags:       string[];
    sensitiveZone:     boolean;
  };
  scoreBreakdown: {
    baseConfidence:  number;
    anomalyBonus:    number;
    recencyPenalty:  number;
    finalConfidence: number;
  };
  nearbyAnomalies: unknown[];
  provenance: {
    gdelt:          Record<string, unknown>;
    maritimeContext: Record<string, unknown>;
    anomalySources: string[];
    anomalyCount:   number;
  };
  rawEvent: {
    url:      string | null;
    domain:   string | null;
    actor1:   string | null;
    actor2:   string | null;
    notes:    string | null;
    headline: string | null;
  };
}

export interface NavalActivityData {
  events:    NavalEvent[];
  anomalies: MaritimeAnomaly[];
  meta: {
    generatedAt:     string;
    count:           number;
    anomalyStatus:   string;
    sourceBreakdown: { gdelt: number; maritimeContext: number; anomalies: number };
  };
}
