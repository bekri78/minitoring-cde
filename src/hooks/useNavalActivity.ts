import { useQuery } from '@tanstack/react-query';
import type { NavalActivityData } from '../types/maritime';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useNavalActivity() {
  return useQuery<NavalActivityData>({
    queryKey:        ['naval-activity'],
    queryFn: async (): Promise<NavalActivityData> => {
      const resp = await fetch(`${RAILWAY_URL}/api/maritime/naval-activity`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 15 * 60 * 1000,  // 15min — données GDELT, pas besoin de plus
    staleTime:       12 * 60 * 1000,
    retry:           2,
  });
}
