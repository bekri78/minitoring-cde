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

export interface NavalActivityData {
  events:    MaritimeAnomaly[];
  anomalies: MaritimeAnomaly[];
  count:     number;
  meta: {
    status:      string;
    generatedAt: string;
    lastUpdate:  string | null;
  };
}
