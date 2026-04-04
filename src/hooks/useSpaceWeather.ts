import { useQuery } from '@tanstack/react-query';
import type { SpaceWeatherData } from '../types/spaceweather';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

export function useSpaceWeather() {
  return useQuery<SpaceWeatherData>({
    queryKey:        ['spaceweather'],
    queryFn: async (): Promise<SpaceWeatherData> => {
      const resp = await fetch(`${RAILWAY_URL}/spaceweather`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 15 * 60 * 1000,
    staleTime:       12 * 60 * 1000,
    retry:           2,
  });
}
