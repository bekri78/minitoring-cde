import { useQuery } from '@tanstack/react-query';
import type { HistoryData } from '../types/history';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useHistory() {
  return useQuery<HistoryData>({
    queryKey:        ['history'],
    queryFn: async (): Promise<HistoryData> => {
      const resp = await fetch(`${RAILWAY_URL}/history`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 60 * 60 * 1000,
    staleTime:       55 * 60 * 1000,
    retry: 2,
  });
}
