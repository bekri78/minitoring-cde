import { useState } from 'react';
import type { DayRecord } from '../types/history';

interface Props {
  data: DayRecord[];
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#ff2244',
  SEVERE:   '#ff5533',
  HIGH:     '#ffaa00',
  MODERATE: '#ffdd55',
  LOW:      '#00d4ff',
};

const CAT_COLOR: Record<string, string> = {
  terrorism: '#ff2244',
  military:  '#ff5533',
  conflict:  '#ffaa00',
  protest:   '#ffdd55',
  crisis:    '#aa44ff',
  incident:  '#00d4ff',
  cyber:     '#00ff88',
  strategic: '#4488ff',
};

function formatDate(d: string) {
  // YYYYMMDD → MM/DD
  return `${d.slice(4, 6)}/${d.slice(6, 8)}`;
}

export function TrendPanel({ data }: Props) {
  const [open, setOpen]     = useState(false);
  const [mode, setMode]     = useState<'count' | 'severity' | 'category'>('count');
  const [hovered, setHover] = useState<number | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position:    'absolute',
          bottom:      '44px',
          left:        '12px',
          background:  'rgba(8,13,19,0.88)',
          border:      '1px solid rgba(0,212,255,0.25)',
          color:       '#00d4ff',
          fontFamily:  "'Share Tech Mono', monospace",
          fontSize:    '11px',
          letterSpacing: '2px',
          padding:     '6px 10px',
          cursor:      'pointer',
        }}
      >
        TRENDS ▲
      </button>
    );
  }

  const days   = data.slice(-30); // last 30 days
  const maxCnt = Math.max(...days.map(d => d.count), 1);

  const CHART_W = 560;
  const CHART_H = 140;
  const BAR_GAP = 2;
  const barW    = Math.floor((CHART_W - BAR_GAP * (days.length - 1)) / Math.max(days.length, 1));

  return (
    <div style={{
      position:   'absolute',
      bottom:     '44px',
      left:       '12px',
      width:      `${CHART_W + 32}px`,
      background: 'rgba(8,13,19,0.94)',
      border:     '1px solid rgba(0,212,255,0.25)',
      padding:    '12px 16px',
      fontFamily: "'Share Tech Mono', monospace",
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ color: '#00d4ff', fontSize: '11px', letterSpacing: '3px' }}>
          INTEL TRENDS — {days.length} DAYS
        </span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {(['count', 'severity', 'category'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              background:  mode === m ? 'rgba(0,212,255,0.15)' : 'transparent',
              border:      `1px solid ${mode === m ? '#00d4ff' : 'rgba(0,212,255,0.2)'}`,
              color:       mode === m ? '#00d4ff' : '#4a6a7a',
              fontFamily:  "'Share Tech Mono', monospace",
              fontSize:    '9px',
              letterSpacing: '1px',
              padding:     '2px 6px',
              cursor:      'pointer',
              textTransform: 'uppercase',
            }}>{m}</button>
          ))}
          <button onClick={() => setOpen(false)} style={{
            background: 'transparent', border: 'none',
            color: '#4a6a7a', cursor: 'pointer', fontSize: '14px', lineHeight: 1,
          }}>×</button>
        </div>
      </div>

      {/* Chart */}
      <svg width={CHART_W} height={CHART_H} style={{ display: 'block', overflow: 'visible' }}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f}
            x1={0} y1={CHART_H * (1 - f)}
            x2={CHART_W} y2={CHART_H * (1 - f)}
            stroke="rgba(0,212,255,0.07)" strokeWidth={1}
          />
        ))}

        {days.map((day, i) => {
          const x = i * (barW + BAR_GAP);

          if (mode === 'count') {
            const h = Math.max(2, (day.count / maxCnt) * CHART_H);
            const isHov = hovered === i;
            return (
              <g key={day.date}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={x} y={CHART_H - h} width={barW} height={h}
                  fill={isHov ? '#00d4ff' : 'rgba(0,212,255,0.5)'}
                />
                {isHov && (
                  <text x={x + barW / 2} y={CHART_H - h - 4}
                    fill="#00d4ff" fontSize={9} textAnchor="middle"
                    fontFamily="'Share Tech Mono', monospace">
                    {day.count}
                  </text>
                )}
              </g>
            );
          }

          if (mode === 'severity') {
            const order = ['CRITICAL', 'SEVERE', 'HIGH', 'MODERATE', 'LOW'];
            let yOff = CHART_H;
            return (
              <g key={day.date}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                {order.map(sev => {
                  const cnt = day.severities[sev] || 0;
                  if (!cnt) return null;
                  const h = (cnt / maxCnt) * CHART_H;
                  yOff -= h;
                  return <rect key={sev} x={x} y={yOff} width={barW} height={h}
                    fill={SEV_COLOR[sev] || '#4a6a7a'} />;
                })}
                {hovered === i && (
                  <text x={x + barW / 2} y={CHART_H - (day.count / maxCnt) * CHART_H - 4}
                    fill="#fff" fontSize={9} textAnchor="middle"
                    fontFamily="'Share Tech Mono', monospace">
                    {day.count}
                  </text>
                )}
              </g>
            );
          }

          // category mode
          const order = ['terrorism', 'military', 'conflict', 'protest', 'crisis', 'cyber', 'strategic', 'incident'];
          let yOff2 = CHART_H;
          return (
            <g key={day.date}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {order.map(cat => {
                const cnt = day.categories[cat] || 0;
                if (!cnt) return null;
                const h = (cnt / maxCnt) * CHART_H;
                yOff2 -= h;
                return <rect key={cat} x={x} y={yOff2} width={barW} height={h}
                  fill={CAT_COLOR[cat] || '#4a6a7a'} />;
              })}
              {hovered === i && (
                <text x={x + barW / 2} y={CHART_H - (day.count / maxCnt) * CHART_H - 4}
                  fill="#fff" fontSize={9} textAnchor="middle"
                  fontFamily="'Share Tech Mono', monospace">
                  {day.count}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* X axis labels — show every ~5 days */}
      <div style={{ display: 'flex', marginTop: '4px', position: 'relative', height: '14px' }}>
        {days.map((day, i) => {
          if (i % 5 !== 0 && i !== days.length - 1) return null;
          return (
            <span key={day.date} style={{
              position:   'absolute',
              left:       `${i * (barW + BAR_GAP) + barW / 2}px`,
              transform:  'translateX(-50%)',
              color:      '#4a6a7a',
              fontSize:   '9px',
              letterSpacing: '0px',
            }}>
              {formatDate(day.date)}
            </span>
          );
        })}
      </div>

      {/* Tooltip on hover */}
      {hovered !== null && days[hovered] && (
        <div style={{
          marginTop: '8px', borderTop: '1px solid rgba(0,212,255,0.15)',
          paddingTop: '6px', fontSize: '10px', color: '#8aa4b4',
        }}>
          <span style={{ color: '#00d4ff' }}>{formatDate(days[hovered].date)}</span>
          {' — '}
          <span style={{ color: '#fff' }}>{days[hovered].count} events</span>
          {mode === 'severity' && (
            <span>
              {' · '}
              {Object.entries(days[hovered].severities)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([k, v]) => (
                  <span key={k} style={{ color: SEV_COLOR[k] || '#fff', marginRight: 6 }}>
                    {k}: {v}
                  </span>
                ))}
            </span>
          )}
          {mode === 'category' && (
            <span>
              {' · '}
              {Object.entries(days[hovered].categories)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([k, v]) => (
                  <span key={k} style={{ color: CAT_COLOR[k] || '#fff', marginRight: 6 }}>
                    {k}: {v}
                  </span>
                ))}
            </span>
          )}
        </div>
      )}

      {/* Legend */}
      {mode !== 'count' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
          {Object.entries(mode === 'severity' ? SEV_COLOR : CAT_COLOR).map(([k, c]) => (
            <span key={k} style={{ fontSize: '9px', color: c, letterSpacing: '1px' }}>
              ■ {k.toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
