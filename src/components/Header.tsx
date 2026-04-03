import type { CSSProperties } from 'react';
import { useFilterStore } from '../store/filterStore';

interface Props {
  eventCount: number;
  status:     'loading' | 'error' | 'success';
  nextRefresh: string;
  onRefresh:  () => void;
}

const btnStyle: CSSProperties = {
  fontFamily:    "'Share Tech Mono', monospace",
  fontSize:      '11px',
  background:    'transparent',
  border:        '1px solid #1a2a3a',
  color:         '#4a6a7a',
  padding:       '4px 12px',
  cursor:        'pointer',
  letterSpacing: '1px',
  transition:    'all 0.2s',
};

export function Header({ eventCount, status, nextRefresh, onRefresh }: Props) {
  const { isOpen, togglePanel } = useFilterStore();

  const statusText  = status === 'loading' ? 'FETCHING' : status === 'error' ? 'OFFLINE' : 'LIVE';
  const dotColor    = status === 'error' ? '#ff4444' : '#00ff88';

  return (
    <header style={{
      background:   '#0a0f16',
      borderBottom: '1px solid #1a2a3a',
      display:      'flex',
      alignItems:   'center',
      padding:      '0 20px',
      gap:          '24px',
      height:       '44px',
    }}>
      {/* Logo */}
      <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '15px', color: '#00d4ff', letterSpacing: '4px' }}>
        WORLD<span style={{ color: '#4a6a7a' }}>//</span>MONITOR
      </div>

      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontFamily: "'Share Tech Mono', monospace", fontSize: '11px' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, animation: 'pulse 1.5s infinite' }} />
        <span style={{ color: '#00d4ff' }}>{statusText}</span>
      </div>

      {/* Event count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontFamily: "'Share Tech Mono', monospace", fontSize: '11px' }}>
        <span style={{ color: '#4a6a7a' }}>EVENTS</span>
        <span style={{ color: '#00d4ff' }}>{eventCount || '—'}</span>
      </div>

      {/* Next refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontFamily: "'Share Tech Mono', monospace", fontSize: '11px' }}>
        <span style={{ color: '#4a6a7a' }}>NEXT</span>
        <span style={{ color: '#4a6a7a', fontSize: '10px' }}>{nextRefresh}</span>
      </div>

      {/* Buttons */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
        <button
          onClick={onRefresh}
          style={btnStyle}
          onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = '#00d4ff'; (e.target as HTMLElement).style.color = '#00d4ff'; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = '#1a2a3a'; (e.target as HTMLElement).style.color = '#4a6a7a'; }}
        >
          ⟳ REFRESH
        </button>
        <button
          onClick={togglePanel}
          style={{ ...btnStyle, borderColor: isOpen ? '#00d4ff' : '#1a2a3a', color: isOpen ? '#00d4ff' : '#4a6a7a' }}
        >
          ⚙ FILTERS
        </button>
      </div>
    </header>
  );
}
