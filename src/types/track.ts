export type MilTier = 'confirmed_military' | 'likely_military' | 'possible_state' | 'unknown';
export type TrackDomain = 'air' | 'sea';

export interface Track {
  domain:     TrackDomain;
  id:         string;              // icao24 (air) or MMSI (sea)
  name:       string;
  callsign:   string;
  country:    string;              // ISO country code (USA, RUS, CHN…)
  color:      string;              // hex color per country
  lon:        number;
  lat:        number;
  alt:        number | null;       // altitude metres (air only)
  altFt:      number | null;       // altitude feet (air only)
  speed:      number | null;       // knots
  heading:    number | null;       // true heading degrees
  cog:        number;              // course over ground
  sog:        number;              // speed over ground
  lastSeen:   number;              // timestamp ms
  trail:        [number, number][];  // [[lon,lat], …]
  isHelicopter: boolean;             // true if ICAO type is a rotorcraft
  milScore:   number;              // 0-100 confidence score
  milTier:    MilTier;             // classification tier
  milReasons: string[];            // explainable reasons
}

export interface TracksMeta {
  totalNormalized: number;
  totalClassified: number;
  totalFiltered:   number;
  airCount:        number;
  seaCount:        number;
  pipelineMs:      number;
  timestamp:       string;
}

export interface TracksData {
  tracks: Track[];
  meta:   TracksMeta;
}
