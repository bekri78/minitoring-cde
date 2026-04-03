import { useQuery } from '@tanstack/react-query';
import type { DecayData } from '../types/decay';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useDecay() {
  return useQuery<DecayData>({
    queryKey:        ['decay'],
    queryFn: async (): Promise<DecayData> => {
      const resp = await fetch(`${RAILWAY_URL}/decay`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 60 * 60 * 1000,  // 1h (backend refresh 1x/jour)
    staleTime:       55 * 60 * 1000,
    retry:           2,
  });
}
