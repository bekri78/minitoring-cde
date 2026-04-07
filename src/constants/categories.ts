export interface Category {
  key: string;
  label: string;
  color: string;
}

export const CATEGORIES: Category[] = [
  { key: 'terrorism', label: 'TERRORISM', color: '#ff0044' },
  { key: 'military',  label: 'MILITARY',  color: '#ff6600' },
  { key: 'conflict',  label: 'CONFLICT',  color: '#ff8800' },
  { key: 'protest',   label: 'PROTEST',   color: '#ffcc00' },
  { key: 'cyber',     label: 'CYBER',     color: '#00ff88' },
  { key: 'strategic', label: 'STRATEGIC', color: '#4488ff' },
  { key: 'crisis',    label: 'CRISIS',    color: '#cc44ff' },
  { key: 'incident',  label: 'INCIDENT',  color: '#4a6a7a' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
