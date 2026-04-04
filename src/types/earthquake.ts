export interface Quake {
  id:      string;
  mag:     number;
  place:   string;
  time:    string | null;
  depth:   number;
  lat:     number;
  lon:     number;
  tsunami: boolean;
  alert:   string | null;
  url:     string;
  sig:     number;
  color:   string;
}

export interface EarthquakeData {
  quakes:     Quake[];
  count:      number;
  lastUpdate: string | null;
  status:     string;
}
