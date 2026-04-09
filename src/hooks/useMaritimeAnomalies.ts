import { useQuery } from '@tanstack/react-query';
import type { MaritimeAnomaly } from '../types/maritime';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

interface AnomaliesResponse {
  anomalies: MaritimeAnomaly[];
  meta: {
    status:     string;
    generatedAt: string;
    lastUpdate:  string | null;
  };
}

export function useMaritimeAnomalies() {
  return useQuery<AnomaliesResponse>({
    queryKey: ['maritime-anomalies'],
    queryFn: async (): Promise<AnomaliesResponse> => {
      const resp = await fetch(`${RAILWAY_URL}/api/maritime/anomalies`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 5 * 60 * 1000,   // 5 min
    staleTime:       4 * 60 * 1000,
    retry: 2,
  });
}
