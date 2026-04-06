import { useState } from 'react';
import type { SpaceWeatherData } from '../types/spaceweather';

interface Props {
  data: SpaceWeatherData | undefined;
}

// Couleur selon indice Kp (0–9)
function kpColor(kp: number | null): string {
  if (kp === null) return '#2a4a5a';
  if (kp >= 7) return '#ff2244';
  if (kp >= 5) return '#ff6600';
  if (kp >= 4) return '#ffaa00';
  if (kp >= 3) return '#ffdd55';
  return '#00ff88';
}

// Couleur selon niveau d'échelle (0–5)
function scaleColor(n: number): string {
  if (n >= 4) return '#ff2244';
  if (n >= 3) return '#ff6600';
  if (n >= 2) return '#ffaa00';
  if (n >= 1) return '#ffdd55';
  return '#2a4a5a';
}

function ScaleBadge({ label, value }: { label: string; value: number }) {
  const color = scaleColor(value);
  const active = value > 0;
  return (
    <span style={{
      padding:    '1px 6px',
      fontSize:   '9px',
      background: active ? `${color}18` : 'rgba(10,15,22,0.5)',
      color:      active ? color : '#2a4a5a',
      border:     `1px solid ${active ? color + '55' : '#1a2a3a'}`,
      letterSpacing: '1px',
    }}>
      {label}{value}
    </span>
  );
}

export function SpaceWeatherWidget({ data }: Props) {
  const [open, setOpen] = useState(false);

  const kp     = data?.kp ?? null;
  const scales = data?.scales ?? { G: 0, S: 0, R: 0 };
  const alerts = data?.alerts ?? [];
  const color  = kpColor(kp);

  // Alerte si n'importe quel niveau > 0
  const hasAlert = kp !== null && kp >= 3 || scales.G > 0 || scales.S > 0 || scales.R > 0;

  return (
    <div style={{
      position:  'absolute',
      bottom:    '10px',
      right:     '10px',
      zIndex:    1000,
      fontFamily:"'Share Tech Mono', monospace",
    }}>
      {/* Panneau détaillé */}
      {open && (
        <div style={{
          marginBottom: '6px',
          background:   '#0a0f16',
          border:       '1px solid #1a2a3a',
          width:        '260px',
          backdropFilter: 'blur(4px)',
        }}>
          {/* Header */}
          <div style={{
            padding:       '7px 10px',
            borderBottom:  '1px solid #1a2a3a',
            display:       'flex',
            justifyContent:'space-between',
            alignItems:    'center',
          }}>
            <span style={{ color: '#00d4ff', fontSize: '10px', letterSpacing: '2px' }}>// MÉTÉO SPATIALE</span>
            {data?.lastUpdate && (
              <span style={{ color: '#2a4a5a', fontSize: '8px' }}>
                {new Date(data.lastUpdate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} UTC
              </span>
            )}
          </div>

          {/* Kp index bar */}
          <div style={{ padding: '10px', borderBottom: '1px solid #0e1a24' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ color: '#4a6a7a', fontSize: '9px', letterSpacing: '1px' }}>INDICE Kp</span>
              <span style={{ color, fontSize: '18px', letterSpacing: '1px' }}>
                {kp !== null ? kp.toFixed(1) : '—'}
              </span>
            </div>
            {/* Barre Kp 0–9 */}
            <div style={{ height: '4px', background: '#0e1a24', position: 'relative' }}>
              {kp !== null && (
                <div style={{
                  position:  'absolute',
                  left:      0,
                  top:       0,
                  height:    '100%',
                  width:     `${Math.min(kp / 9 * 100, 100)}%`,
                  background: color,
                  transition: 'width 0.5s',
                }} />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
              <span style={{ color: '#2a4a5a', fontSize: '7px' }}>0</span>
              <span style={{ color: '#ffdd55', fontSize: '7px' }}>3 (actif)</span>
              <span style={{ color: '#ff2244', fontSize: '7px' }}>7 (sévère)</span>
              <span style={{ color: '#2a4a5a', fontSize: '7px' }}>9</span>
            </div>
          </div>

          {/* Echelles G/S/R */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #0e1a24', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <ScaleBadge label="G" value={scales.G} />
            <ScaleBadge label="S" value={scales.S} />
            <ScaleBadge label="R" value={scales.R} />
            <span style={{ color: '#2a4a5a', fontSize: '8px', alignSelf: 'center', marginLeft: 'auto' }}>
              Géomag · Solaire · Radio
            </span>
          </div>

          {/* Alertes */}
          {alerts.length > 0 ? (
            <div>
              {alerts.map(a => (
                <div key={a.id} style={{ padding: '6px 10px', borderTop: '1px solid #0a1018' }}>
                  <div style={{ color: '#4a6a7a', fontSize: '7px', marginBottom: '2px' }}>
                    {new Date(a.time).toUTCString().replace(' GMT', ' UTC')}
                  </div>
                  <div style={{ color: '#c8d8e8', fontSize: '9px', lineHeight: 1.4 }}>{a.headline}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '8px 10px', color: '#2a4a5a', fontSize: '9px' }}>
              Aucune alerte active
            </div>
          )}
        </div>
      )}

      {/* Bouton compact */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        '6px',
          padding:    '5px 10px',
          background: open ? 'rgba(0,212,255,0.1)' : 'rgba(8,13,19,0.9)',
          border:     `1px solid ${open ? 'rgba(0,212,255,0.4)' : hasAlert ? color + '55' : '#1a2a3a'}`,
          color:      '#c8d8e8',
          cursor:     'pointer',
          backdropFilter: 'blur(4px)',
          fontFamily: "'Share Tech Mono', monospace",
          fontSize:   '10px',
          letterSpacing: '1px',
        }}
      >
        <span style={{ color: '#4a6a7a' }}>☀</span>
        <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
          Kp {kp !== null ? kp.toFixed(1) : '—'}
        </span>
        {scales.G > 0 && <ScaleBadge label="G" value={scales.G} />}
        {scales.S > 0 && <ScaleBadge label="S" value={scales.S} />}
        {scales.R > 0 && <ScaleBadge label="R" value={scales.R} />}
        {alerts.length > 0 && (
          <span style={{ color: '#ffaa00', fontSize: '9px' }}>⚠{alerts.length}</span>
        )}
      </button>
    </div>
  );
}
