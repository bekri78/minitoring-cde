import { useQuery } from '@tanstack/react-query';
import type { TracksData, TrackDomain, MilTier } from '../types/track';

const RAILWAY_URL = 'https://minitoring-cde-production.up.railway.app';

interface UseTracksOptions {
  domain?:  TrackDomain;
  country?: string;
  minTier?: MilTier;
}

export function useTracks(opts: UseTracksOptions = {}) {
  const params = new URLSearchParams();
  if (opts.domain)  params.set('domain',  opts.domain);
  if (opts.country) params.set('country', opts.country);
  if (opts.minTier) params.set('minTier', opts.minTier);
  const qs = params.toString();

  return useQuery<TracksData>({
    queryKey: ['tracks', opts.domain, opts.country, opts.minTier],
    queryFn: async (): Promise<TracksData> => {
      const resp = await fetch(`${RAILWAY_URL}/tracks${qs ? '?' + qs : ''}`);
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 15_000,   // 15s — unified refresh
    staleTime:       10_000,
    retry:           2,
  });
}
