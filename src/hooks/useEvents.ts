import { useQuery } from '@tanstack/react-query';
import type { Event } from '../types/event';
import { getColor, getCategoryColor, getSeverityLabel } from '../utils/classify';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

function normalizeEvent(e: Partial<Event>): Event {
  const tone = Number(e.tone) || 0;
  const rawLat = e.rawLat ?? Number(e.lat) ?? 0;
  const rawLon = e.rawLon ?? Number(e.lon) ?? 0;
  return {
    ...(e as Event),
    tone,
    rawLat,
    rawLon,
    lat: rawLat + (Math.random() - 0.5) * 0.5,
    lon: rawLon + (Math.random() - 0.5) * 0.5,
    color:         e.color         || getColor(tone),
    categoryColor: e.categoryColor || getCategoryColor(e.category || 'incident'),
    severity:      e.severity      || getSeverityLabel(tone),
  };
}

export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: async (): Promise<Event[]> => {
      const resp = await fetch(`${RAILWAY_URL}/events`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      const data = await resp.json();
      const events = Array.isArray(data.events) ? data.events : [];
      const seen = new Set<string | number>();
      return events
        .map(normalizeEvent)
        .filter(e => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });
    },
    refetchInterval: 60 * 60 * 1000,
    staleTime:       59 * 60 * 1000,
    retry: 2,
  });
}
