import { create } from 'zustand';

type FilterKey = 'severity' | 'categories' | 'regions';

interface FilterStore {
  severity:   Set<string>;
  categories: Set<string>;
  regions:    Set<string>;
  isOpen:     boolean;
  toggle:      (type: FilterKey, value: string) => void;
  reset:       () => void;
  togglePanel: () => void;
}

const DEFAULT_SEVERITY   = new Set(['critical', 'severe', 'high', 'moderate', 'low']);
const DEFAULT_CATEGORIES = new Set(['terrorism', 'military', 'conflict', 'protest', 'crisis', 'incident']);
const DEFAULT_REGIONS    = new Set(['europe', 'middleeast', 'asia', 'africa', 'americas', 'oceania']);

export const useFilterStore = create<FilterStore>((set) => ({
  severity:   new Set(DEFAULT_SEVERITY),
  categories: new Set(DEFAULT_CATEGORIES),
  regions:    new Set(DEFAULT_REGIONS),
  isOpen:     false,

  toggle: (type, value) => set(state => {
    const next = new Set(state[type]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return { [type]: next };
  }),

  reset: () => set({
    severity:   new Set(DEFAULT_SEVERITY),
    categories: new Set(DEFAULT_CATEGORIES),
    regions:    new Set(DEFAULT_REGIONS),
  }),

  togglePanel: () => set(state => ({ isOpen: !state.isOpen })),
}));
