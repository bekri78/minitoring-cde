import { useState, useEffect, useRef } from 'react';
import type { Launch, SpaceEvent, LaunchData } from '../types/launch';
import type { DecayObject, DecayData } from '../types/decay';
import type { TipObject, TipData } from '../types/tip';

interface Props {
  data:      LaunchData | undefined;
  decay:     DecayData  | undefined;
  tip:       TipData    | undefined;
  loading:   boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCountdown(isoDate: string | null): string {
  if (!isoDate) return '—';
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'LAUNCHED';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000)  / 60_000);
  const s = Math.floor((diff % 60_000)     / 1_000);
  const hms = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return d > 0 ? `${d}J ${hms}` : hms;
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const day  = String(d.getUTCDate()).padStart(2, '0');
  const mon  = MONTHS[d.getUTCMonth()];
  const h    = String(d.getUTCHours()).padStart(2, '0');
  const min  = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${mon} ${h}:${min} UTC`;
}

function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NextLaunchCard({ launch, tick }: { launch: Launch; tick: number }) {
  void tick; // force re-render on each tick
  return (
    <div style={{
      margin:     '0 12px 12px',
      padding:    '10px 12px',
      background: 'rgba(0,212,255,0.04)',
      border:     `1px solid ${launch.status.color}44`,
    }}>
      {launch.image && (
        <img
          src={launch.image}
          alt={launch.name}
          style={{ width: '100%', borderRadius: '3px', marginBottom: '8px', border: '1px solid #1a2a3a', display: 'block' }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div style={{ fontSize: '22px', color: launch.status.color, letterSpacing: '2px', fontVariantNumeric: 'tabular-nums' }}>
        T− {formatCountdown(launch.net)}
      </div>
      <div style={{ marginTop: '6px', color: '#c8d8e8', fontSize: '10px', lineHeight: 1.5 }}>
        {truncate(launch.name, 48)}
      </div>
      <div style={{ marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge status={launch.status} />
        <span style={{ color: '#4a6a7a', fontSize: '9px' }}>{launch.rocket}</span>
        <span style={{ color: '#4a6a7a', fontSize: '9px', marginLeft: 'auto' }}>{launch.pad.country}</span>
      </div>
      {(launch.mission.type || launch.mission.orbit) && (
        <div style={{ marginTop: '4px', color: '#4a6a7a', fontSize: '9px' }}>
          {launch.mission.type}{launch.mission.orbit ? ` · ${launch.mission.orbit}` : ''}
        </div>
      )}
      {launch.pad.name && (
        <div style={{ marginTop: '4px', color: '#2a5a6a', fontSize: '9px' }}>
          ◈ {truncate(launch.pad.name, 44)}
        </div>
      )}
      {launch.mission.desc && (
        <div style={{
          marginTop:    '8px',
          paddingTop:   '8px',
          borderTop:    '1px solid #0e1a24',
          color:        '#6a8a9a',
          fontSize:     '9px',
          lineHeight:   1.6,
        }}>
          {truncate(launch.mission.desc, 220)}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Launch['status'] }) {
  return (
    <span style={{
      padding:    '1px 6px',
      fontSize:   '9px',
      background: `${status.color}18`,
      color:      status.color,
      border:     `1px solid ${status.color}44`,
      letterSpacing: '1px',
    }}>
      {status.label}
    </span>
  );
}

function LaunchRow({ launch }: { launch: Launch }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(launch.mission.desc || launch.pad.name || launch.mission.orbit);
  return (
    <div
      style={{ padding: '8px 12px', borderTop: '1px solid #0e1a24', cursor: hasDetails ? 'pointer' : 'default' }}
      onClick={() => hasDetails && setExpanded(e => !e)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
        <StatusBadge status={launch.status} />
        <span style={{ color: '#c8d8e8', fontSize: '10px', flex: 1, minWidth: 0 }}>
          {truncate(launch.name, 38)}
        </span>
        {hasDetails && (
          <span style={{ color: '#2a5a6a', fontSize: '9px', flexShrink: 0 }}>{expanded ? '▴' : '▾'}</span>
        )}
      </div>
      <div style={{ color: '#4a6a7a', fontSize: '9px', paddingLeft: '2px', display: 'flex', justifyContent: 'space-between' }}>
        <span>{truncate(launch.provider, 22)}</span>
        <span>{formatDate(launch.net)}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #0e1a24' }}>
          {launch.image && (
            <img
              src={launch.image}
              alt={launch.name}
              style={{ width: '100%', borderRadius: '3px', marginBottom: '6px', border: '1px solid #1a2a3a', display: 'block' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          {(launch.mission.type || launch.mission.orbit) && (
            <div style={{ color: '#4a6a7a', fontSize: '9px', marginBottom: '3px' }}>
              {launch.rocket}{launch.mission.type ? ` · ${launch.mission.type}` : ''}{launch.mission.orbit ? ` · ${launch.mission.orbit}` : ''}
            </div>
          )}
          {launch.pad.name && (
            <div style={{ color: '#2a5a6a', fontSize: '9px', marginBottom: '3px' }}>
              ◈ {truncate(launch.pad.name, 44)}
            </div>
          )}
          {launch.mission.desc && (
            <div style={{ color: '#6a8a9a', fontSize: '9px', lineHeight: 1.6 }}>
              {truncate(launch.mission.desc, 200)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: SpaceEvent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{ padding: '8px 12px', borderTop: '1px solid #0e1a24', cursor: 'pointer' }}
      onClick={() => setExpanded(e => !e)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
        {event.type && (
          <span style={{
            padding: '1px 6px', fontSize: '9px',
            background: 'rgba(204,68,255,0.12)', color: '#cc44ff',
            border: '1px solid rgba(204,68,255,0.3)', letterSpacing: '1px',
          }}>
            {event.type.toUpperCase().slice(0, 10)}
          </span>
        )}
        {event.webcastLive && (
          <span style={{ fontSize: '9px', color: '#ff2244' }}>● LIVE</span>
        )}
        <span style={{ color: '#c8d8e8', fontSize: '10px', flex: 1, minWidth: 0 }}>
          {truncate(event.name, 36)}
        </span>
        <span style={{ color: '#2a5a6a', fontSize: '9px' }}>{expanded ? '▴' : '▾'}</span>
      </div>
      <div style={{ color: '#4a6a7a', fontSize: '9px', paddingLeft: '2px', display: 'flex', justifyContent: 'space-between' }}>
        <span>{truncate(event.location, 22)}</span>
        <span>{formatDate(event.date)}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #0e1a24' }}>
          {event.image && (
            <img
              src={event.image}
              alt={event.name}
              style={{ width: '100%', borderRadius: '3px', marginBottom: '6px', border: '1px solid #1a2a3a', display: 'block' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          {event.description && (
            <div style={{ color: '#6a8a9a', fontSize: '9px', lineHeight: 1.6 }}>
              {truncate(event.description, 200)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TipRow({ obj }: { obj: TipObject }) {
  const hoursLabel = obj.hoursLeft != null
    ? obj.hoursLeft < 1 ? '< 1H' : `${obj.hoursLeft.toFixed(1)}H`
    : '—';
  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid #0e1a24' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
        <span style={{
          padding: '1px 6px', fontSize: '9px',
          background: `${obj.color}18`, color: obj.color,
          border: `1px solid ${obj.color}44`, letterSpacing: '1px',
        }}>
          {hoursLabel}
        </span>
        {obj.highInterest && (
          <span style={{ fontSize: '9px', color: '#ff2244' }}>⚠</span>
        )}
        <span style={{ color: '#c8d8e8', fontSize: '10px', flex: 1, minWidth: 0 }}>
          {truncate(obj.name, 26)}
        </span>
        <span style={{ color: '#4a6a7a', fontSize: '9px' }}>{obj.country}</span>
      </div>
      <div style={{ color: '#4a6a7a', fontSize: '9px', paddingLeft: '2px', display: 'flex', gap: '8px' }}>
        <span>{obj.objectType || 'DEBRIS'}</span>
        <span>±{obj.window}min</span>
        <span style={{ marginLeft: 'auto' }}>{formatDate(obj.decayEpoch)}</span>
      </div>
    </div>
  );
}

function DecayRow({ obj }: { obj: DecayObject }) {
  const daysLabel = obj.daysLeft != null
    ? obj.daysLeft < 1 ? '< 24H' : `${obj.daysLeft.toFixed(1)}J`
    : '—';
  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid #0e1a24' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
        <span style={{
          padding: '1px 6px', fontSize: '9px',
          background: `${obj.color}18`, color: obj.color,
          border: `1px solid ${obj.color}44`, letterSpacing: '1px',
        }}>
          {daysLabel}
        </span>
        <span style={{ color: '#c8d8e8', fontSize: '10px', flex: 1, minWidth: 0 }}>
          {truncate(obj.name, 30)}
        </span>
        <span style={{ color: '#4a6a7a', fontSize: '9px' }}>{obj.country}</span>
      </div>
      <div style={{ color: '#4a6a7a', fontSize: '9px', paddingLeft: '2px', display: 'flex', gap: '8px' }}>
        <span>inc {obj.inclination}°</span>
        <span>apo {obj.apogee} km</span>
        <span style={{ marginLeft: 'auto' }}>{formatDate(obj.decayEpoch)}</span>
      </div>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{
      padding:       '8px 12px',
      background:    '#080d13',
      borderTop:     '1px solid #1a2a3a',
      borderBottom:  '1px solid #0e1a24',
      display:       'flex',
      justifyContent:'space-between',
      alignItems:    'center',
    }}>
      <span style={{ color: '#00d4ff', fontSize: '10px', letterSpacing: '2px' }}>{title}</span>
      <span style={{ color: '#4a6a7a', fontSize: '9px' }}>{count}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SpacePanel({ data, decay, tip, loading }: Props) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick every second to update countdown
  useEffect(() => {
    if (open && data?.launches.length) {
      intervalRef.current = setInterval(() => setTick(t => t + 1), 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [open, data?.launches.length]);

  const next     = data?.launches[0] ?? null;
  const rest     = data?.launches.slice(1) ?? [];
  const events   = data?.events ?? [];
  const previous = data?.previous ?? [];
  const decayList = (decay?.objects ?? []).sort((a, b) => (a.daysLeft ?? 99) - (b.daysLeft ?? 99));
  const tipList   = (tip?.objects   ?? []).sort((a, b) => (a.hoursLeft ?? 9999) - (b.hoursLeft ?? 9999));

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        title={open ? 'Fermer Space Monitor' : 'Ouvrir Space Monitor'}
        style={{
          position:      'absolute',
          top:           '10px',
          left:          '10px',
          zIndex:        300,
          fontFamily:    "'Share Tech Mono', monospace",
          fontSize:      '10px',
          letterSpacing: '1px',
          background:    open ? 'rgba(0,212,255,0.15)' : 'rgba(8,13,19,0.9)',
          color:         open ? '#00d4ff' : '#4a6a7a',
          border:        `1px solid ${open ? 'rgba(0,212,255,0.4)' : '#1a2a3a'}`,
          padding:       '5px 10px',
          cursor:        'pointer',
          backdropFilter:'blur(4px)',
        }}
      >
        {open ? '✕ SPACE' : '◈ SPACE'}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position:   'absolute',
          top:        0,
          left:       0,
          width:      '300px',
          height:     '100%',
          background: '#0a0f16',
          borderRight:'1px solid #1a2a3a',
          zIndex:     200,
          display:    'flex',
          flexDirection: 'column',
          fontFamily: "'Share Tech Mono', monospace",
          overflow:   'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding:       '10px 12px',
            borderBottom:  '1px solid #1a2a3a',
            display:       'flex',
            justifyContent:'space-between',
            alignItems:    'center',
            flexShrink:    0,
          }}>
            <span style={{ color: '#00d4ff', fontSize: '11px', letterSpacing: '2px' }}>// SPACE MONITOR</span>
            {data?.lastUpdate && (
              <span style={{ color: '#2a4a5a', fontSize: '8px' }}>
                {new Date(data.lastUpdate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} UTC
              </span>
            )}
          </div>

          {/* Scrollable body */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && !data && (
              <div style={{ padding: '20px 12px', color: '#4a6a7a', fontSize: '10px', textAlign: 'center' }}>
                CHARGEMENT...
              </div>
            )}

            {/* TIP — en tête absolu car rentrées imminentes avec coordonnées réelles */}
            {tipList.length > 0 && (
              <>
                <SectionHeader title="IMPACT PRÉDIT (TIP)" count={tipList.length} />
                {tipList.map(o => <TipRow key={o.id} obj={o} />)}
              </>
            )}

            {/* Rentrées atmosphériques — en tête car priorité sécurité */}
            {decayList.length > 0 && (
              <>
                <SectionHeader title="RENTRÉES (30J)" count={decayList.length} />
                {decayList.map(o => <DecayRow key={o.id} obj={o} />)}
              </>
            )}

            {/* Next launch countdown */}
            {next && (
              <>
                <SectionHeader title="PROCHAIN LANCEMENT" count={data!.launches.length} />
                <NextLaunchCard launch={next} tick={tick} />
              </>
            )}

            {/* Upcoming launches */}
            {rest.length > 0 && (
              <>
                <SectionHeader title="LANCEMENTS À VENIR" count={rest.length} />
                {rest.map(l => <LaunchRow key={l.id} launch={l} />)}
              </>
            )}

            {/* Recent launches */}
            {previous.length > 0 && (
              <>
                <SectionHeader title="RÉCENTS" count={previous.length} />
                {previous.map(l => <LaunchRow key={l.id} launch={l} />)}
              </>
            )}

            {/* Space events */}
            {events.length > 0 && (
              <>
                <SectionHeader title="ÉVÉNEMENTS SPATIAUX" count={events.length} />
                {events.map(e => <EventRow key={e.id} event={e} />)}
              </>
            )}

            {!loading && !next && events.length === 0 && (
              <div style={{ padding: '20px 12px', color: '#4a6a7a', fontSize: '10px', textAlign: 'center' }}>
                AUCUNE DONNÉE
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
