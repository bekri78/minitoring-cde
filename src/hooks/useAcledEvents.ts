import { useQuery } from '@tanstack/react-query';
import type { Event } from '../types/event';
import { getColor, getCategoryColor } from '../utils/classify';

const ACLED_PROXY_URL = 'https://tight-river-31b9.projet7.workers.dev';

function mapAcledCategory(eventType: string): string {
  const map: Record<string, string> = {
    'Battles': 'military',
    'Explosions/Remote violence': 'military',
    'Violence against civilians': 'conflict',
    'Riots': 'protest',
    'Protests': 'protest',
    'Strategic developments': 'crisis',
  };
  return map[eventType] || 'incident';
}

function acledToTone(fatalities: string | number): number {
  const f = parseInt(String(fatalities)) || 0;
  if (f >= 20) return -10;
  if (f >= 10) return -8;
  if (f >= 5)  return -6;
  if (f >= 1)  return -4;
  return -2;
}

export function useAcledEvents() {
  return useQuery({
    queryKey: ['acled-events'],
    queryFn: async (): Promise<Event[]> => {
      const today = new Date();
      const from  = new Date(today);
      from.setDate(from.getDate() - 1);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const params = new URLSearchParams({
        _format: 'json',
        event_date: `${fmt(from)}|${fmt(today)}`,
        event_date_where: 'BETWEEN',
        fields: 'event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|location|latitude|longitude|fatalities|notes|source',
        limit: '500',
      });

      const resp = await fetch(`${ACLED_PROXY_URL}?${params}`);
      if (!resp.ok) throw new Error(`ACLED proxy failed (${resp.status})`);

      const data = await resp.json();
      const rows: Record<string, string>[] = data.data || [];

      return rows
        .map(row => {
          const lat = parseFloat(row.latitude);
          const lon = parseFloat(row.longitude);
          if (isNaN(lat) || isNaN(lon)) return null;

          const cat   = mapAcledCategory(row.event_type);
          const tone  = acledToTone(row.fatalities);
          const notes = (row.notes || '').trim();
          const title = notes.length > 180
            ? notes.slice(0, 177) + '…'
            : (notes || `${row.event_type} — ${row.location}`);

          return {
            id:            `acled_${row.event_id_cnty}`,
            title,
            url:           '',
            domain:        row.source || 'ACLED',
            date:          (row.event_date || '').replace(/-/g, ''),
            country:       row.country || '',
            rawLat: lat, rawLon: lon, lat, lon,
            tone,
            color:         getColor(tone),
            category:      cat,
            categoryColor: getCategoryColor(cat),
            score:         100 + (parseInt(row.fatalities) || 0) * 5,
            fatalities:    parseInt(row.fatalities) || 0,
            actor1:        row.actor1 || '',
            actor2:        row.actor2 || '',
            subType:       row.sub_event_type || '',
            dataSource:    'acled',
          } as Event;
        })
        .filter((e): e is Event => e !== null);
    },
    refetchInterval: 15 * 60 * 1000,
    staleTime:       14 * 60 * 1000,
    retry: 1,
  });
}
