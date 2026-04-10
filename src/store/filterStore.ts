import { create } from 'zustand';

type FilterKey = 'severity' | 'categories' | 'regions';

/** Vue domaine : quel type de données afficher sur la carte */
export type DomainView = 'all' | 'air' | 'sea' | 'space' | 'osint';

interface FilterStore {
  severity:   Set<string>;
  categories: Set<string>;
  regions:    Set<string>;
  isOpen:     boolean;
  domainView: DomainView;
  toggle:         (type: FilterKey, value: string) => void;
  reset:          () => void;
  togglePanel:    () => void;
  setDomainView:  (view: DomainView) => void;
}

const DEFAULT_SEVERITY   = new Set(['critical', 'severe', 'high', 'moderate', 'low']);
const DEFAULT_CATEGORIES = new Set(['terrorism', 'military', 'conflict', 'protest', 'cyber', 'strategic', 'crisis', 'incident']);
const DEFAULT_REGIONS    = new Set(['europe', 'middleeast', 'asia', 'africa', 'americas', 'oceania']);

export const useFilterStore = create<FilterStore>((set) => ({
  severity:   new Set(DEFAULT_SEVERITY),
  categories: new Set(DEFAULT_CATEGORIES),
  regions:    new Set(DEFAULT_REGIONS),
  isOpen:     false,
  domainView: 'all' as DomainView,

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

  setDomainView: (view) => set({ domainView: view }),
}));
