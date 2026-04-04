import { useQuery } from '@tanstack/react-query';
import type { EarthquakeData } from '../types/earthquake';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useEarthquakes() {
  return useQuery<EarthquakeData>({
    queryKey:        ['earthquakes'],
    queryFn: async (): Promise<EarthquakeData> => {
      const resp = await fetch(`${RAILWAY_URL}/earthquakes`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 15 * 60 * 1000,  // 15min
    staleTime:       12 * 60 * 1000,
    retry:           2,
  });
}
