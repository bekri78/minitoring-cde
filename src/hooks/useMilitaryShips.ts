import { useQuery } from '@tanstack/react-query';
import type { MilShipData } from '../types/ship';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useMilitaryShips() {
  return useQuery<MilShipData>({
    queryKey:        ['military-ships'],
    queryFn: async (): Promise<MilShipData> => {
      const resp = await fetch(`${RAILWAY_URL}/military-ships`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 30 * 1000,  // 30s — les navires bougent moins vite que les avions
    staleTime:       20 * 1000,
    retry:           2,
  });
}
