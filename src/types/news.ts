export interface NewsEvent {
  id:          string;
  title:       string;
  url:         string;
  source:      string;
  date:        string;
  lat:         number;
  lon:         number;
  location:    string | null;
  domain:      string;        // spatial | missile | naval | aviation | military
  eventType:   string;
  confidence:  number;        // 0-100
  color:       string;
  icon:        string;
  label:       string;
  dataSource:  'google-news';
}

export interface NewsEventsResponse {
  events:      NewsEvent[];
  count:       number;
  lastUpdate:  string | null;
  status:      string;
  generatedAt: string;
}
