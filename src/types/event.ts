export interface Event {
  id: string;
  title: string;
  url: string;
  domain: string;
  date: string;
  country: string;
  lat: number;
  lon: number;
  rawLat?: number;
  rawLon?: number;
  tone: number;
  color?: string;
  severity?: string;
  score?: number;
  category: string;
  categoryColor?: string;
  dataSource?: string;
  fatalities?: number;
  actor1?: string;
  actor2?: string;
  subType?: string;
  rootCode?: string;
}
