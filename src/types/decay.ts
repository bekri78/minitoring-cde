export interface DecayObject {
  id:          string;   // NORAD_CAT_ID
  name:        string;   // OBJECT_NAME
  objectId:    string;   // désignateur international (ex: 1998-067A)
  decayEpoch:  string | null;  // ISO — date/heure prévue de rentrée
  window:      number;   // incertitude en heures
  inclination: number;   // degrés
  apogee:      number;   // km
  perigee:     number;   // km
  country:     string;   // code pays Space-Track (US, CIS, PRC…)
  msgEpoch:    string | null;  // quand la prédiction a été publiée
  daysLeft:    number | null;  // jours restants calculés côté serveur
  color:       string;   // hex selon urgence
  lat:         number;   // pays de lancement + jitter
  lon:         number;
}

export interface DecayData {
  objects:    DecayObject[];
  count:      number;
  lastUpdate: string | null;
  status:     string;
}
