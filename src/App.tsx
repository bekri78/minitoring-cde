import { useMemo, useCallback, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEvents }      from './hooks/useEvents';
import { useLaunches }    from './hooks/useLaunches';
import { useDecay }       from './hooks/useDecay';
import { useTip }         from './hooks/useTip';
import { useHistory }     from './hooks/useHistory';
import { useFilterStore } from './store/filterStore';
import { Header }         from './components/Header';
import { WorldMap }       from './components/WorldMap';
import { FilterPanel }    from './components/FilterPanel';
import { SpacePanel }     from './components/SpacePanel';
import { TrendPanel }     from './components/TrendPanel';
import { getSeverityKey } from './utils/classify';
import { getRegionKey }   from './utils/geo';
import type { Event }     from './types/event';

export default function App() {
  const queryClient = useQueryClient();
  const { data: gdeltEvents, status: gdeltStatus } = useEvents();
  const { data: launchData,  status: launchStatus } = useLaunches();
  const { data: decayData }   = useDecay();
  const { data: tipData }     = useTip();
  const { data: historyData } = useHistory();
  const { severity, categories, regions } = useFilterStore();

  const [nextRefresh,     setNextRefresh]     = useState('—');
  const [nextRefreshTime, setNextRefreshTime] = useState(0);

  // Combine sources
  const allEvents = useMemo<Event[]>(() => gdeltEvents || [], [gdeltEvents]);

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

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['events'] });
  }, [queryClient]);

  return (
    <div style={{ height: '100vh', display: 'grid', gridTemplateRows: '44px 1fr' }}>
      <Header
        eventCount={filteredEvents.length}
        status={gdeltStatus === 'pending' ? 'loading' : gdeltStatus === 'error' ? 'error' : 'success'}
        nextRefresh={nextRefresh}
        onRefresh={handleRefresh}
      />
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <WorldMap events={filteredEvents} loading={gdeltStatus === 'pending'} pads={launchData?.pads} decayObjects={decayData?.objects} tipObjects={tipData?.objects} />
        <FilterPanel />
        <SpacePanel data={launchData} decay={decayData} tip={tipData} loading={launchStatus === 'pending'} />
        <TrendPanel data={historyData?.history ?? []} />
      </div>
    </div>
  );
}
