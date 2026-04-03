export interface Category {
  key: string;
  label: string;
  color: string;
}

export const CATEGORIES: Category[] = [
  { key: 'terrorism', label: 'TERRORISM', color: '#ff0044' },
  { key: 'military',  label: 'MILITARY',  color: '#ff6600' },
  { key: 'conflict',  label: 'CONFLICT',  color: '#ffaa00' },
  { key: 'protest',   label: 'PROTEST',   color: '#ffee00' },
  { key: 'crisis',    label: 'CRISIS',    color: '#cc44ff' },
  { key: 'incident',  label: 'INCIDENT',  color: '#4a6a7a' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
