export interface Category {
  key: string;
  label: string;
  color: string;
}

export const CATEGORIES: Category[] = [
  { key: 'military',  label: 'MILITARY',  color: '#ff4400' },
  { key: 'protest',   label: 'PROTEST',   color: '#ffcc00' },
  { key: 'incident',  label: 'INCIDENT',  color: '#00d4ff' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
