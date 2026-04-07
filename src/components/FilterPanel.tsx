import type { ReactNode } from 'react';
import { useFilterStore } from '../store/filterStore';

interface FilterOption {
  value: string;
  label: string;
  color?: string;
  sub?: string;
}

const SEVERITY_OPTIONS: FilterOption[] = [
  { value: 'critical', label: 'CRITICAL', color: '#ff2244', sub: '≤ -7' },
  { value: 'severe',   label: 'SEVERE',   color: '#ff5533', sub: '-7 to -5' },
  { value: 'high',     label: 'HIGH',     color: '#ffaa00', sub: '-5 to -2' },
  { value: 'moderate', label: 'MODERATE', color: '#ffdd55', sub: '-2 to 0' },
  { value: 'low',      label: 'LOW',      color: '#00d4ff', sub: '> 0' },
];

const CATEGORY_OPTIONS: FilterOption[] = [
  { value: 'terrorism', label: 'TERRORISM', color: '#ff0044' },
  { value: 'military',  label: 'MILITARY',  color: '#ff6600' },
  { value: 'conflict',  label: 'CONFLICT',  color: '#ff8800' },
  { value: 'protest',   label: 'PROTEST',   color: '#ffcc00' },
  { value: 'cyber',     label: 'CYBER',     color: '#00ff88' },
  { value: 'strategic', label: 'STRATEGIC', color: '#4488ff' },
  { value: 'crisis',    label: 'CRISIS',    color: '#cc44ff' },
  { value: 'incident',  label: 'INCIDENT',  color: '#4a6a7a' },
];

const REGION_OPTIONS: FilterOption[] = [
  { value: 'europe',     label: 'EUROPE' },
  { value: 'middleeast', label: 'MIDDLE EAST' },
  { value: 'asia',       label: 'ASIA' },
  { value: 'africa',     label: 'AFRICA' },
  { value: 'americas',   label: 'AMERICAS' },
  { value: 'oceania',    label: 'OCEANIA' },
];

export function FilterPanel() {
  const { severity, categories, regions, isOpen, toggle, reset, togglePanel } = useFilterStore();

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={togglePanel}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }}
      />

      {/* Panel */}
      <div style={{
        position:   'fixed',
        top:        44,
        right:      0,
        width:      300,
        height:     'calc(100vh - 44px)',
        background: '#0a0f16',
        borderLeft: '1px solid #1a2a3a',
        zIndex:     201,
        overflowY:  'auto',
        fontFamily: "'Share Tech Mono', monospace",
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #1a2a3a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#00d4ff', fontSize: '11px', letterSpacing: '2px' }}>// FILTERS</span>
          <button
            onClick={reset}
            style={{ fontFamily: 'inherit', fontSize: '10px', background: 'transparent', border: '1px solid #1a2a3a', color: '#4a6a7a', padding: '3px 10px', cursor: 'pointer' }}
          >
            RESET
          </button>
        </div>

        <Section title="SEVERITY">
          {SEVERITY_OPTIONS.map(opt => (
            <Checkbox
              key={opt.value}
              checked={severity.has(opt.value)}
              onChange={() => toggle('severity', opt.value)}
              label={opt.label}
              color={opt.color}
              sub={opt.sub}
            />
          ))}
        </Section>

        <Section title="TYPE">
          {CATEGORY_OPTIONS.map(opt => (
            <Checkbox
              key={opt.value}
              checked={categories.has(opt.value)}
              onChange={() => toggle('categories', opt.value)}
              label={opt.label}
              color={opt.color}
            />
          ))}
        </Section>

        <Section title="REGION">
          {REGION_OPTIONS.map(opt => (
            <Checkbox
              key={opt.value}
              checked={regions.has(opt.value)}
              onChange={() => toggle('regions', opt.value)}
              label={opt.label}
            />
          ))}
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid #1a2a3a' }}>
      <div style={{ fontSize: '10px', color: '#4a6a7a', letterSpacing: '1px', marginBottom: '10px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>{children}</div>
    </div>
  );
}

function Checkbox({ checked, onChange, label, color, sub }: {
  checked: boolean; onChange: () => void; label: string; color?: string; sub?: string;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11px', letterSpacing: '1px', padding: '2px 0' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ accentColor: '#00d4ff', width: 12, height: 12, cursor: 'pointer' }}
      />
      <span style={{ color: color || '#c8d8e8' }}>{label}</span>
      {sub && <span style={{ color: '#4a6a7a', fontSize: '9px', marginLeft: 'auto' }}>{sub}</span>}
    </label>
  );
}
