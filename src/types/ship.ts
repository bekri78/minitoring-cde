export interface MilShip {
  id:       string;        // MMSI (9 chiffres)
  name:     string;        // nom du navire
  callsign: string;        // indicatif radio
  country:  string;        // code pays
  color:    string;        // couleur hex selon pays
  lon:      number;
  lat:      number;
  cog:      number;        // cap sur le fond (degrees)
  sog:      number;        // vitesse fond (noeuds)
  heading:  number | null; // cap vrai (411 = inconnu)
  lastSeen: number;        // timestamp ms
  trail:    [number, number][]; // [[lon,lat], ...]
}

export interface MilShipData {
  ships:      MilShip[];
  count:      number;
  lastUpdate: string | null;
  connected:  boolean;
  status?:    'live' | 'connecting' | 'stale' | 'disconnected';
  stale?:     boolean;
  dataAgeMs?: number | null;
  cacheSavedAt?: string | null;
}
