import { useQuery } from '@tanstack/react-query';
import type { NewsEventsResponse, NewsEvent } from '../types/news';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useNewsEvents() {
  return useQuery<NewsEvent[]>({
    queryKey: ['news-events'],
    queryFn:  async (): Promise<NewsEvent[]> => {
      const resp = await fetch(`${RAILWAY_URL}/api/news/events`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      const data: NewsEventsResponse = await resp.json();
      return Array.isArray(data.events) ? data.events : [];
    },
    refetchInterval: 3 * 60 * 60 * 1000, // 3h — matches server cron
    staleTime:       2.5 * 60 * 60 * 1000,
    retry:           2,
  });
}
