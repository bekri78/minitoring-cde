export interface SwScales {
  G: number;  // Geomagnetic storm  0–5
  S: number;  // Solar radiation    0–5
  R: number;  // Radio blackout     0–5
}

export interface SwAlert {
  id:       string;
  time:     string;
  headline: string;
}

export interface SpaceWeatherData {
  kp:         number | null;
  scales:     SwScales;
  alerts:     SwAlert[];
  lastUpdate: string | null;
  status:     string;
}
