import { useQuery } from '@tanstack/react-query';
import type { LaunchData } from '../types/launch';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useLaunches() {
  return useQuery<LaunchData>({
    queryKey:        ['launches'],
    queryFn: async (): Promise<LaunchData> => {
      const resp = await fetch(`${RAILWAY_URL}/launches`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 60 * 60 * 1000,  // 1h (backend refreshes every 4h)
    staleTime:       55 * 60 * 1000,
    retry:           2,
  });
}
