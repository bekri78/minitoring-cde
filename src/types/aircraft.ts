export interface MilAircraft {
  id:       string;       // icao24 hex
  callsign: string;
  country:  string;       // code pays (USA, RUS, CHN, ...)
  color:    string;       // couleur hex selon pays
  lon:      number;
  lat:      number;
  alt:      number | null; // altitude baro en mètres
  altFt:    number | null; // altitude en pieds
  speed:    number | null; // vitesse en noeuds
  track:    number;        // cap en degrés (0-360)
  trail:    [number, number][]; // [[lon,lat], ...] positions précédentes
}

export interface MilAircraftData {
  aircraft:   MilAircraft[];
  count:      number;
  lastUpdate: string | null;
  status:     string;
}
