import { useQuery } from '@tanstack/react-query';
import type { MilAircraftData } from '../types/aircraft';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useMilitaryAircraft() {
  return useQuery<MilAircraftData>({
    queryKey:        ['military-aircraft'],
    queryFn: async (): Promise<MilAircraftData> => {
      const resp = await fetch(`${RAILWAY_URL}/military-aircraft`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 5 * 60 * 1000,   // 5min — synchronisé avec le cache serveur
    staleTime:       4 * 60 * 1000,
    retry:           2,
  });
}
