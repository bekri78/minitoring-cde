import { COUNTRY_COORDS } from '../constants/countries';
import type { Event } from '../types/event';

export function getRegionKey(lat: number, lon: number): string {
  if (lat > 34 && lat < 72 && lon > -25 && lon < 45) return 'europe';
  if (lat > 12 && lat < 43 && lon > 25 && lon < 65)  return 'middleeast';
  if (lat > -12 && lat < 55 && lon > 60 && lon < 150) return 'asia';
  if (lat > -35 && lat < 38 && lon > -20 && lon < 55) return 'africa';
  if (lon > -170 && lon < -30) return 'americas';
  return 'oceania';
}

export function coordsForCountry(name: string): { lat: number; lon: number } | null {
  if (!name) return null;
  if (COUNTRY_COORDS[name]) return COUNTRY_COORDS[name];
  const lower = name.toLowerCase();
  const key = Object.keys(COUNTRY_COORDS).find(
    k => lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)
  );
  return key ? COUNTRY_COORDS[key] : null;
}

export function buildGeoJSON(events: Event[]) {
  const coordCount = new Map<string, number>();
  const coordIdx   = new Map<string, number>();

  events.forEach(e => {
    const key = `${Number(e.lon).toFixed(2)},${Number(e.lat).toFixed(2)}`;
    coordCount.set(key, (coordCount.get(key) || 0) + 1);
  });

  return {
    type: 'FeatureCollection' as const,
    features: events.map(e => {
      const key   = `${Number(e.lon).toFixed(2)},${Number(e.lat).toFixed(2)}`;
      const total = coordCount.get(key) || 1;
      const idx   = coordIdx.get(key) || 0;
      coordIdx.set(key, idx + 1);

      let lon = Number(e.lon);
      let lat = Number(e.lat);
      if (total > 1) {
        const angle  = (idx / total) * 2 * Math.PI;
        const radius = 0.18;
        lon += Math.cos(angle) * radius;
        lat += Math.sin(angle) * radius;
      }

      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lon, lat] },
        properties: {
          id:            e.id,
          title:         e.title || '',
          url:           e.url || '',
          domain:        e.domain || '',
          date:          e.date || '',
          country:       e.country || '',
          tone:          Number(e.tone),
          color:         e.color  || '#4a6a7a',
          severity:      e.severity || 'LOW',
          score:         Number(e.score || 0),
          size:          Math.max(5, Math.min(16, Math.abs(Number(e.tone) || 0) + 5)),
          category:      e.category || 'incident',
          categoryColor: e.categoryColor || '#4a6a7a',
          dataSource:    e.dataSource || 'gdelt',
          fatalities:    Number(e.fatalities || 0),
          actor1:        e.actor1 || '',
          actor2:        e.actor2 || '',
          subType:       e.subType || '',
          eventCode:     (e as any).eventCode || '',
          rootCode:      e.rootCode || '',
          subEventType:  (e as any).subEventType || e.subType || '',
        },
      };
    }),
  };
}
