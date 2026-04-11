import { useMemo, useCallback, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEvents }      from './hooks/useEvents';
import { useLaunches }    from './hooks/useLaunches';
import { useDecay }       from './hooks/useDecay';
import { useTip }          from './hooks/useTip';
import { useEarthquakes }       from './hooks/useEarthquakes';
import { useSpaceWeather }      from './hooks/useSpaceWeather';
import { useTracks } from './hooks/useTracks';
import { useNavalActivity }     from './hooks/useNavalActivity';
import { useNewsEvents }        from './hooks/useNewsEvents';
import { useHistory }      from './hooks/useHistory';
import { useFilterStore } from './store/filterStore';
import type { DomainView } from './store/filterStore';
import { Header }         from './components/Header';
import { WorldMap }       from './components/WorldMap';
import { FilterPanel }    from './components/FilterPanel';
import { SpacePanel }          from './components/SpacePanel';
import { TrendPanel }          from './components/TrendPanel';
import { SpaceWeatherWidget }  from './components/SpaceWeatherWidget';
import { getSeverityKey } from './utils/classify';
import { getRegionKey }   from './utils/geo';
import type { Event }     from './types/event';

export default function App() {
  const queryClient = useQueryClient();
  const { data: gdeltEvents, status: gdeltStatus } = useEvents();
  const { data: launchData,  status: launchStatus } = useLaunches();
  const { data: decayData }   = useDecay();
  const { data: tipData }     = useTip();
  const { data: quakeData }   = useEarthquakes();
  const { data: swData }      = useSpaceWeather();
  const { data: tracksData }  = useTracks();
  const { data: navalData }    = useNavalActivity();
  const { data: newsEventsData } = useNewsEvents();
  const { data: historyData } = useHistory();
  const { severity, categories, regions } = useFilterStore();
  const domainView = useFilterStore((s): DomainView => s.domainView);

  const [nextRefresh,     setNextRefresh]     = useState('—');
  const [nextRefreshTime, setNextRefreshTime] = useState(0);

  // Combine sources
  const allEvents  = useMemo<Event[]>(() => gdeltEvents || [], [gdeltEvents]);
  const airTracks  = useMemo(() => (tracksData?.tracks.filter(t => t.domain === 'air') ?? [])
    .filter(t => t.country !== 'USA' || (t as any).milScore === 100), [tracksData]);
  const seaTracks  = useMemo(() => tracksData?.tracks.filter(t => t.domain === 'sea') ?? [], [tracksData]);
  const navalEvents = useMemo(() => navalData?.events ?? [], [navalData]);
  const newsEvents  = useMemo(() => newsEventsData ?? [], [newsEventsData]);

  // Apply filters
  const filteredEvents = useMemo(() => allEvents.filter(e => {
    const sev    = getSeverityKey(Number(e.tone));
    const region = getRegionKey(Number(e.lat), Number(e.lon));
    const cat    = e.category || 'incident';
    return severity.has(sev) && regions.has(region) && categories.has(cat);
  }), [allEvents, severity, regions, categories]);

  // Countdown to next auto-refresh
  useEffect(() => {
    setNextRefreshTime(Date.now() + 60 * 60 * 1000);
  }, [gdeltEvents]);

  useEffect(() => {
    const id = setInterval(() => {
      const remaining = Math.max(0, nextRefreshTime - Date.now());
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setNextRefresh(`${m}:${String(s).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, [nextRefreshTime]);

  // Visible count depends on domain view
  const visibleCount = useMemo(() => {
    switch (domainView) {
      case 'air':   return airTracks.length;
      case 'sea':   return seaTracks.length + navalEvents.length;
      case 'space': return (launchData?.launches?.length || 0) + (decayData?.objects?.length || 0) + (tipData?.objects?.length || 0);
      case 'osint': return filteredEvents.length;
      default:      return filteredEvents.length + airTracks.length + seaTracks.length + navalEvents.length + newsEvents.length;
    }
  }, [domainView, filteredEvents, airTracks, seaTracks, navalEvents, newsEvents, launchData, decayData, tipData]);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['events'] });
  }, [queryClient]);

  return (
    <div style={{ height: '100vh', display: 'grid', gridTemplateRows: '44px 1fr' }}>
      <Header
        eventCount={visibleCount}
        status={gdeltStatus === 'pending' ? 'loading' : gdeltStatus === 'error' ? 'error' : 'success'}
        nextRefresh={nextRefresh}
        onRefresh={handleRefresh}
      />
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <WorldMap events={filteredEvents} loading={gdeltStatus === 'pending'} pads={launchData?.pads} decayObjects={decayData?.objects} tipObjects={tipData?.objects} quakes={quakeData?.quakes} airTracks={airTracks} seaTracks={seaTracks} launches={launchData?.launches} navalEvents={navalEvents} newsEvents={newsEvents} />
        <FilterPanel />
        <SpacePanel data={launchData} decay={decayData} tip={tipData} loading={launchStatus === 'pending'} />
        <TrendPanel data={historyData?.history ?? []} />
        <SpaceWeatherWidget data={swData} />
      </div>
    </div>
  );
}
