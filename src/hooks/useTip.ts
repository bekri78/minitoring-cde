import { useQuery } from '@tanstack/react-query';
import type { TipData } from '../types/tip';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useTip() {
  return useQuery<TipData>({
    queryKey:        ['tip'],
    queryFn: async (): Promise<TipData> => {
      const resp = await fetch(`${RAILWAY_URL}/tip`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 6 * 60 * 60 * 1000,  // 6h (même fréquence que le cron)
    staleTime:       5 * 60 * 60 * 1000,
    retry:           2,
  });
}
