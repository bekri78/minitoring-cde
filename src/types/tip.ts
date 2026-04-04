export interface TipObject {
  id:          string;   // NORAD_CAT_ID
  name:        string;   // OBJECT_NAME
  objectId:    string;   // désignateur international
  objectType:  string;   // DEBRIS / ROCKET BODY / PAYLOAD
  decayEpoch:  string | null;  // ISO — heure estimée de rentrée
  window:      number;   // incertitude en minutes
  inclination: number;   // degrés
  direction:   string;   // Asc / Desc
  country:     string;   // code pays Space-Track
  highInterest: boolean; // objet d'intérêt particulier
  msgEpoch:    string | null;  // quand le message TIP a été publié
  hoursLeft:   number | null;  // heures restantes calculées côté serveur
  color:       string;   // hex selon urgence
  lat:         number;   // position orbitale au moment de la rentrée prédite
  lon:         number;
}

export interface TipData {
  objects:    TipObject[];
  count:      number;
  lastUpdate: string | null;
  status:     string;
}
